import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// دالة للتحقق من صلاحيات المدير
async function requireAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("يجب تسجيل الدخول أولاً");
  }

  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user_id", (q: any) => q.eq("userId", userId))
    .first();

  if (!profile || !profile.isAdmin) {
    throw new Error("ليس لديك صلاحيات المدير");
  }

  return { userId, profile };
}

// الحصول على جميع المستخدمين (للمدير فقط)
export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    
    const profiles = await ctx.db.query("userProfiles").collect();
    const users = await Promise.all(
      profiles.map(async (profile) => {
        const user = await ctx.db.get(profile.userId);
        return {
          ...profile,
          user,
        };
      })
    );

    return users.sort((a, b) => a.username.localeCompare(b.username));
  },
});

// تحديث خصميات المستخدم (للمدير فقط)
export const updateUserDeductions = mutation({
  args: {
    userId: v.id("users"),
    deductions: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) {
      throw new Error("المستخدم غير موجود");
    }

    await ctx.db.patch(profile._id, {
      deductions: args.deductions,
    });

    return { success: true };
  },
});

// تحديث اسم المستخدم (للمدير فقط)
export const updateUsername = mutation({
  args: {
    userId: v.id("users"),
    newUsername: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // التحقق من عدم وجود اسم المستخدم الجديد
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_username", (q) => q.eq("username", args.newUsername))
      .first();

    if (existingProfile && existingProfile.userId !== args.userId) {
      throw new Error("اسم المستخدم موجود بالفعل");
    }

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) {
      throw new Error("المستخدم غير موجود");
    }

    await ctx.db.patch(profile._id, {
      username: args.newUsername,
    });

    return { success: true };
  },
});

// حذف مستخدم (للمدير فقط)
export const deleteUser = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) {
      throw new Error("المستخدم غير موجود");
    }

    if (profile.isAdmin) {
      throw new Error("لا يمكن حذف حساب المدير");
    }

    // حذف جميع البيانات المرتبطة بالمستخدم
    const dailyEntries = await ctx.db
      .query("dailyEntries")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    for (const entry of dailyEntries) {
      await ctx.db.delete(entry._id);
    }

    const monthlyAdvances = await ctx.db
      .query("monthlyAdvances")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    for (const advance of monthlyAdvances) {
      await ctx.db.delete(advance._id);
    }

    // حذف ملف المستخدم
    await ctx.db.delete(profile._id);

    // حذف المستخدم من جدول المصادقة
    await ctx.db.delete(args.userId);

    return { success: true };
  },
});

// تصفير كامل للنظام (للمدير فقط) - حذف جميع البيانات والمستخدمين عدا المدير الحالي
export const completeSystemReset = mutation({
  args: {
    confirmationText: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId: adminUserId } = await requireAdmin(ctx);

    // التحقق من نص التأكيد
    if (args.confirmationText !== "تصفير كامل") {
      throw new Error("نص التأكيد غير صحيح");
    }

    // حذف جميع المدخلات اليومية
    const allDailyEntries = await ctx.db.query("dailyEntries").collect();
    for (const entry of allDailyEntries) {
      await ctx.db.delete(entry._id);
    }

    // حذف جميع السلفيات الشهرية
    const allMonthlyAdvances = await ctx.db.query("monthlyAdvances").collect();
    for (const advance of allMonthlyAdvances) {
      await ctx.db.delete(advance._id);
    }

    // حذف جميع المستخدمين عدا المدير الحالي
    const allProfiles = await ctx.db.query("userProfiles").collect();
    for (const profile of allProfiles) {
      if (profile.userId !== adminUserId) {
        // حذف ملف المستخدم
        await ctx.db.delete(profile._id);
        // حذف المستخدم من جدول المصادقة
        await ctx.db.delete(profile.userId);
      }
    }

    // إعادة تعيين خصميات المدير إلى الصفر
    const adminProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", adminUserId))
      .first();

    if (adminProfile) {
      await ctx.db.patch(adminProfile._id, {
        deductions: 0,
      });
    }

    return { 
      success: true, 
      message: "تم تصفير النظام بالكامل بنجاح. تم حذف جميع البيانات والمستخدمين عدا حسابك كمدير." 
    };
  },
});

// تصفير البيانات فقط (الاحتفاظ بالمستخدمين)
export const resetDataOnly = mutation({
  args: {
    confirmationText: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // التحقق من نص التأكيد
    if (args.confirmationText !== "تصفير البيانات") {
      throw new Error("نص التأكيد غير صحيح");
    }

    // حذف جميع المدخلات اليومية
    const allDailyEntries = await ctx.db.query("dailyEntries").collect();
    for (const entry of allDailyEntries) {
      await ctx.db.delete(entry._id);
    }

    // حذف جميع السلفيات الشهرية
    const allMonthlyAdvances = await ctx.db.query("monthlyAdvances").collect();
    for (const advance of allMonthlyAdvances) {
      await ctx.db.delete(advance._id);
    }

    // إعادة تعيين خصميات جميع المستخدمين إلى الصفر
    const allProfiles = await ctx.db.query("userProfiles").collect();
    for (const profile of allProfiles) {
      await ctx.db.patch(profile._id, {
        deductions: 0,
      });
    }

    return { 
      success: true, 
      message: "تم تصفير جميع البيانات المالية بنجاح. تم الاحتفاظ بجميع المستخدمين." 
    };
  },
});

export const getAllUsersCurrentMonthData = query({
  args: { year: v.number(), month: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const yearMonth = `${args.year}-${args.month.toString().padStart(2, '0')}`;
    const entries = await ctx.db.query("dailyEntries").collect();
    const monthEntries = entries.filter(e => e.date.startsWith(yearMonth));
    
    const userTotals = new Map();
    let totalAmount = 0;
    
    for (const entry of monthEntries) {
      const total = (entry.cashAmount || 0) + (entry.networkAmount || 0);
      totalAmount += total;
      userTotals.set(entry.userId, (userTotals.get(entry.userId) || 0) + total);
    }
    
    return {
      totalAmount,
      totalEntries: monthEntries.length,
      activeUsers: userTotals.size,
      userTotals: Array.from(userTotals.entries()).map(([userId, totalAmount]) => ({ userId, totalAmount })),
    };
  },
});

// الحصول على ملخص شامل للحسابات حسب الأيام (للمدير فقط)
export const getComprehensiveMonthlySummary = query({
  args: { year: v.number(), month: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    
    const yearMonth = `${args.year}-${args.month.toString().padStart(2, '0')}`;
    
    // الحصول على جميع المدخلات للشهر المحدد
    const allEntries = await ctx.db.query("dailyEntries").collect();
    const monthEntries = allEntries.filter(e => e.date.startsWith(yearMonth));
    
    // الحصول على جميع المستخدمين
    const allProfiles = await ctx.db.query("userProfiles").collect();
    const usersMap = new Map();
    for (const profile of allProfiles) {
      usersMap.set(profile.userId, profile);
    }
    
    // تجميع البيانات حسب التاريخ
    const dailySummary = new Map();
    let totalCash = 0;
    let totalNetwork = 0;
    let totalPurchases = 0;
    let totalAdvances = 0;
    let totalDeductions = 0;
    
    for (const entry of monthEntries) {
      const date = entry.date;
      const userProfile = usersMap.get(entry.userId);
      
      if (!dailySummary.has(date)) {
        dailySummary.set(date, {
          date,
          totalCash: 0,
          totalNetwork: 0,
          totalPurchases: 0,
          totalAdvances: 0,
          totalAmount: 0,
          totalRemaining: 0,
          entriesCount: 0,
          userEntries: []
        });
      }
      
      const dayData = dailySummary.get(date);
      const cashAmount = entry.cashAmount || 0;
      const networkAmount = entry.networkAmount || 0;
      const purchasesAmount = entry.purchasesAmount || 0;
      const advanceAmount = entry.advanceAmount || 0;
      const userDeductions = userProfile?.deductions || 0;
      
      dayData.totalCash += cashAmount;
      dayData.totalNetwork += networkAmount;
      dayData.totalPurchases += purchasesAmount;
      dayData.totalAdvances += advanceAmount;
      dayData.totalAmount += (cashAmount + networkAmount);
      dayData.totalRemaining += (cashAmount + networkAmount - purchasesAmount);
      dayData.entriesCount += 1;
      
      dayData.userEntries.push({
        userId: entry.userId,
        username: userProfile?.username || 'مستخدم محذوف',
        cashAmount,
        networkAmount,
        purchasesAmount,
        advanceAmount,
        deductions: userDeductions,
        total: cashAmount + networkAmount,
        remaining: cashAmount + networkAmount - purchasesAmount
      });
      
      // إضافة للمجاميع الكلية
      totalCash += cashAmount;
      totalNetwork += networkAmount;
      totalPurchases += purchasesAmount;
      totalAdvances += advanceAmount;
      totalDeductions += userDeductions;
    }
    
    // تحويل الخريطة إلى مصفوفة مرتبة حسب التاريخ
    const sortedDailySummary = Array.from(dailySummary.values())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // حساب إحصائيات إضافية
    const totalGross = totalCash + totalNetwork;
    const totalNet = totalGross - totalPurchases;
    const averageDailyAmount = sortedDailySummary.length > 0 ? totalGross / sortedDailySummary.length : 0;
    const activeDays = sortedDailySummary.length;
    const daysInMonth = new Date(args.year, args.month, 0).getDate();
    
    return {
      year: args.year,
      month: args.month,
      dailySummary: sortedDailySummary,
      totals: {
        totalCash,
        totalNetwork,
        totalGross,
        totalPurchases,
        totalNet,
        totalAdvances,
        totalDeductions,
        averageDailyAmount,
        activeDays,
        daysInMonth,
        activeUsers: new Set(monthEntries.map(e => e.userId)).size
      }
    };
  },
});

// الحصول على ملخص المستخدمين للشهر (للمدير فقط)
export const getUsersMonthlySummary = query({
  args: { year: v.number(), month: v.number() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    
    const yearMonth = `${args.year}-${args.month.toString().padStart(2, '0')}`;
    
    // الحصول على جميع المدخلات للشهر المحدد
    const allEntries = await ctx.db.query("dailyEntries").collect();
    const monthEntries = allEntries.filter(e => e.date.startsWith(yearMonth));
    
    // الحصول على جميع المستخدمين
    const allProfiles = await ctx.db.query("userProfiles").collect();
    
    // تجميع البيانات حسب المستخدم
    const usersSummary = new Map();
    
    for (const profile of allProfiles) {
      usersSummary.set(profile.userId, {
        userId: profile.userId,
        username: profile.username,
        isAdmin: profile.isAdmin,
        deductions: profile.deductions || 0,
        totalCash: 0,
        totalNetwork: 0,
        totalPurchases: 0,
        totalAdvances: 0,
        totalAmount: 0,
        totalRemaining: 0,
        entriesCount: 0,
        activeDays: 0
      });
    }
    
    // معالجة المدخلات
    for (const entry of monthEntries) {
      if (usersSummary.has(entry.userId)) {
        const userData = usersSummary.get(entry.userId);
        const cashAmount = entry.cashAmount || 0;
        const networkAmount = entry.networkAmount || 0;
        const purchasesAmount = entry.purchasesAmount || 0;
        const advanceAmount = entry.advanceAmount || 0;
        
        userData.totalCash += cashAmount;
        userData.totalNetwork += networkAmount;
        userData.totalPurchases += purchasesAmount;
        userData.totalAdvances += advanceAmount;
        userData.totalAmount += (cashAmount + networkAmount);
        userData.totalRemaining += (cashAmount + networkAmount - purchasesAmount);
        userData.entriesCount += 1;
      }
    }
    
    // حساب الأيام النشطة لكل مستخدم
    const userActiveDays = new Map();
    for (const entry of monthEntries) {
      if (!userActiveDays.has(entry.userId)) {
        userActiveDays.set(entry.userId, new Set());
      }
      userActiveDays.get(entry.userId).add(entry.date);
    }
    
    for (const [userId, dates] of userActiveDays) {
      if (usersSummary.has(userId)) {
        usersSummary.get(userId).activeDays = dates.size;
      }
    }
    
    // تحويل إلى مصفوفة مرتبة حسب المجموع
    const sortedUsersSummary = Array.from(usersSummary.values())
      .sort((a, b) => b.totalAmount - a.totalAmount);
    
    return sortedUsersSummary;
  },
});
