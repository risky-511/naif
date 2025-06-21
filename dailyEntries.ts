import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// دالة للحصول على ملف المستخدم
async function getUserProfile(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("يجب تسجيل الدخول أولاً");
  }

  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user_id", (q: any) => q.eq("userId", userId))
    .first();

  if (!profile) {
    throw new Error("ملف المستخدم غير موجود");
  }

  return { userId, profile };
}

// الحصول على المدخلات اليومية لمستخدم معين
export const getDailyEntries = query({
  args: {
    targetUserId: v.optional(v.id("users")),
    year: v.optional(v.number()),
    month: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, profile } = await getUserProfile(ctx);
    
    // تحديد المستخدم المستهدف
    const targetUserId = args.targetUserId || userId;
    
    // التحقق من الصلاحيات
    if (targetUserId !== userId && !profile.isAdmin) {
      throw new Error("ليس لديك صلاحية لعرض هذه البيانات");
    }

    let query = ctx.db.query("dailyEntries").withIndex("by_user", (q) => q.eq("userId", targetUserId));

    // تصفية حسب السنة والشهر إذا تم تحديدهما
    if (args.year && args.month) {
      const yearMonth = `${args.year}-${args.month.toString().padStart(2, '0')}`;
      query = ctx.db.query("dailyEntries").withIndex("by_user", (q) => q.eq("userId", targetUserId));
    }

    const entries = await query.collect();
    
    // تصفية حسب السنة والشهر في الكود
    let filteredEntries = entries;
    if (args.year && args.month) {
      const yearMonth = `${args.year}-${args.month.toString().padStart(2, '0')}`;
      filteredEntries = entries.filter(entry => entry.date.startsWith(yearMonth));
    }

    return filteredEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },
});

// إضافة أو تحديث مدخل يومي
export const upsertDailyEntry = mutation({
  args: {
    date: v.string(),
    cashAmount: v.optional(v.number()),
    networkAmount: v.optional(v.number()),
    purchasesAmount: v.optional(v.number()),
    advanceAmount: v.optional(v.number()),
    notes: v.optional(v.string()),
    targetUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { userId, profile } = await getUserProfile(ctx);
    
    const targetUserId = args.targetUserId || userId;
    
    // التحقق من الصلاحيات للتعديل
    if (targetUserId !== userId && !profile.isAdmin) {
      throw new Error("ليس لديك صلاحية لتعديل هذه البيانات");
    }

    // الحصول على ملف المستخدم المستهدف للحصول على الخصميات
    const targetUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", targetUserId))
      .first();

    // حساب المجموع والمتبقي مع الخصميات
    const cashAmount = args.cashAmount || 0;
    const networkAmount = args.networkAmount || 0;
    const purchasesAmount = args.purchasesAmount || 0;
    const deductions = targetUserProfile?.deductions || 0;
    
    const total = cashAmount + networkAmount;
    const remaining = total - purchasesAmount;

    // البحث عن مدخل موجود
    const existingEntry = await ctx.db
      .query("dailyEntries")
      .withIndex("by_user_and_date", (q) => q.eq("userId", targetUserId).eq("date", args.date))
      .first();

    const entryData = {
      userId: targetUserId,
      date: args.date,
      cashAmount: args.cashAmount,
      networkAmount: args.networkAmount,
      purchasesAmount: args.purchasesAmount,
      advanceAmount: args.advanceAmount,
      notes: args.notes,
      total,
      remaining,
      updatedAt: Date.now(),
    };

    if (existingEntry) {
      // تحديث المدخل الموجود
      await ctx.db.patch(existingEntry._id, entryData);
    } else {
      // إنشاء مدخل جديد
      await ctx.db.insert("dailyEntries", {
        ...entryData,
        createdAt: Date.now(),
      });
    }

    // تحديث السلفيات التراكمية للشهر
    if (args.advanceAmount) {
      await updateMonthlyAdvances(ctx, targetUserId, args.date, args.advanceAmount);
    }

    return { success: true };
  },
});

// حذف مدخل يومي (للمدير فقط)
export const deleteDailyEntry = mutation({
  args: {
    entryId: v.id("dailyEntries"),
  },
  handler: async (ctx, args) => {
    const { profile } = await getUserProfile(ctx);
    
    if (!profile.isAdmin) {
      throw new Error("ليس لديك صلاحية لحذف البيانات");
    }

    await ctx.db.delete(args.entryId);
    return { success: true };
  },
});

// تحديث السلفيات التراكمية الشهرية
async function updateMonthlyAdvances(ctx: any, userId: string, date: string, advanceAmount: number) {
  const yearMonth = date.substring(0, 7); // YYYY-MM
  
  const existingAdvance = await ctx.db
    .query("monthlyAdvances")
    .withIndex("by_user_and_month", (q: any) => q.eq("userId", userId).eq("yearMonth", yearMonth))
    .first();

  // حساب إجمالي السلفيات للشهر
  const monthlyEntries = await ctx.db
    .query("dailyEntries")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();

  const monthlyAdvancesTotal = monthlyEntries
    .filter((entry: any) => entry.date.startsWith(yearMonth) && entry.advanceAmount)
    .reduce((sum: number, entry: any) => sum + (entry.advanceAmount || 0), 0);

  if (existingAdvance) {
    await ctx.db.patch(existingAdvance._id, {
      totalAdvances: monthlyAdvancesTotal,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("monthlyAdvances", {
      userId,
      yearMonth,
      totalAdvances: monthlyAdvancesTotal,
      updatedAt: Date.now(),
    });
  }
}

// الحصول على السلفيات التراكمية للشهر
export const getMonthlyAdvances = query({
  args: {
    yearMonth: v.string(),
    targetUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { userId, profile } = await getUserProfile(ctx);
    
    const targetUserId = args.targetUserId || userId;
    
    if (targetUserId !== userId && !profile.isAdmin) {
      throw new Error("ليس لديك صلاحية لعرض هذه البيانات");
    }

    const monthlyAdvance = await ctx.db
      .query("monthlyAdvances")
      .withIndex("by_user_and_month", (q) => q.eq("userId", targetUserId).eq("yearMonth", args.yearMonth))
      .first();

    return monthlyAdvance?.totalAdvances || 0;
  },
});
