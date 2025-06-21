import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const applicationTables = {
  // جدول المستخدمين مع معلومات إضافية
  userProfiles: defineTable({
    userId: v.id("users"),
    username: v.string(),
    isAdmin: v.boolean(),
    deductions: v.optional(v.number()), // الخصميات الثابتة
    createdAt: v.number(),
  })
    .index("by_user_id", ["userId"])
    .index("by_username", ["username"]),

  // جدول المدخلات اليومية
  dailyEntries: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD format
    cashAmount: v.optional(v.number()),
    networkAmount: v.optional(v.number()),
    purchasesAmount: v.optional(v.number()),
    advanceAmount: v.optional(v.number()), // السلفيات
    notes: v.optional(v.string()),
    total: v.optional(v.number()), // المجموع التلقائي
    remaining: v.optional(v.number()), // المتبقي التلقائي
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_and_date", ["userId", "date"])
    .index("by_user", ["userId"])
    .index("by_date", ["date"]),

  // جدول السلفيات التراكمية الشهرية
  monthlyAdvances: defineTable({
    userId: v.id("users"),
    yearMonth: v.string(), // YYYY-MM format
    totalAdvances: v.number(), // إجمالي السلفيات للشهر
    updatedAt: v.number(),
  })
    .index("by_user_and_month", ["userId", "yearMonth"])
    .index("by_user", ["userId"]),
};

export default defineSchema({
  ...authTables,
  ...applicationTables,
});
