import { z } from 'zod'

import { emailSchema, userRoleSchema, userSchema } from './auth'

export const updateProfileRequestSchema = z
  .object({
    displayName: z.union([z.string().trim().min(2).max(80), z.null()]),
  })
  .strict()

export const updateProfileResponseSchema = z
  .object({
    user: userSchema,
  })
  .strict()

const positiveIntegerQuerySchema = (defaultValue: number, maximum?: number) =>
  z.coerce.number().int().positive().max(maximum ?? Number.MAX_SAFE_INTEGER).default(defaultValue)

export const ADMIN_USERS_MAX_PAGE = 100

export const adminUsersQuerySchema = z
  .object({
    q: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().max(100).optional(),
    ),
    page: positiveIntegerQuerySchema(1, ADMIN_USERS_MAX_PAGE),
    pageSize: positiveIntegerQuerySchema(20, 100),
  })
  .strict()

export const adminUserParamsSchema = z
  .object({
    userId: z.uuid(),
  })
  .strict()

export const adminUserSummarySchema = z
  .object({
    id: z.string(),
    email: emailSchema,
    displayName: z.string().nullable(),
    role: userRoleSchema,
    createdAt: z.string().datetime(),
  })
  .strict()

export const adminUsersResponseSchema = z
  .object({
    items: z.array(adminUserSummarySchema),
    page: z.number().int().positive().max(ADMIN_USERS_MAX_PAGE),
    pageSize: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    hasNext: z.boolean(),
  })
  .strict()

export const adminDashboardResponseSchema = z
  .object({
    totalUsers: z.number().int().nonnegative(),
    totalAdmins: z.number().int().nonnegative(),
    newUsersLast7Days: z.number().int().nonnegative(),
  })
  .strict()

export const updateUserRoleRequestSchema = z
  .object({
    role: userRoleSchema,
  })
  .strict()

export const updateUserRoleResponseSchema = z
  .object({
    user: adminUserSummarySchema,
  })
  .strict()

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type UpdateProfileResponse = z.infer<typeof updateProfileResponseSchema>
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>
export type AdminDashboardResponse = z.infer<typeof adminDashboardResponseSchema>
export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleRequestSchema>
export type UpdateUserRoleResponse = z.infer<typeof updateUserRoleResponseSchema>
