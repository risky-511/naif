import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// إنشاء ملف المستخدم بعد التسجيل
export const createUserProfile = mutation({
  args: {
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("يجب تسجيل الدخول أولاً");
    }

    // التحقق من عدم وجود ملف مستخدم بالفعل
    const existingProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .first();

    if (existingProfile) {
      return existingProfile;
    }

    // التحقق من عدم وجود اسم المستخدم
    const existingUsername = await ctx.db
      .query("userProfiles")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();

    if (existingUsername) {
      throw new Error("اسم المستخدم موجود بالفعل");
    }

    // التحقق إذا كان هذا أول مستخدم (سيكون مدير)
    const allProfiles = await ctx.db.query("userProfiles").collect();
    const isFirstUser = allProfiles.length === 0;

    // إنشاء ملف المستخدم
    const profileId = await ctx.db.insert("userProfiles", {
      userId,
      username: args.username,
      isAdmin: isFirstUser, // المستخدم الأول سيكون مدير
      createdAt: Date.now(),
    });

    return await ctx.db.get(profileId);
  },
});

// التحقق من وجود ملف المستخدم
export const checkUserProfile = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .first();

    return profile;
  },
});

// الحصول على ملف مستخدم معين (للمدير أو المستخدم نفسه)
export const getUserProfile = query({
  args: {
    targetUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("يجب تسجيل الدخول أولاً");
    }

    const currentUserProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .first();

    if (!currentUserProfile) {
      throw new Error("ملف المستخدم غير موجود");
    }

    const targetUserId = args.targetUserId || userId;

    // التحقق من الصلاحيات
    if (targetUserId !== userId && !currentUserProfile.isAdmin) {
      throw new Error("ليس لديك صلاحية لعرض هذه البيانات");
    }

    const targetProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", targetUserId))
      .first();

    return targetProfile;
  },
});
