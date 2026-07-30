import { ForbiddenError } from "./errors.js"

export function hasPermission<Permission extends string>(
  availablePermissions: readonly Permission[],
  permission: Permission
): boolean {
  return availablePermissions.includes(permission)
}

export function hasAnyPermission<Permission extends string>(
  availablePermissions: readonly Permission[],
  permissions: readonly Permission[]
): boolean {
  return permissions.some((permission) => hasPermission(availablePermissions, permission))
}

export function hasAllPermissions<Permission extends string>(
  availablePermissions: readonly Permission[],
  permissions: readonly Permission[]
): boolean {
  return permissions.every((permission) => hasPermission(availablePermissions, permission))
}

export function assertPermission<Permission extends string>(
  availablePermissions: readonly Permission[],
  permission: Permission
): void {
  if (!hasPermission(availablePermissions, permission)) {
    throw new ForbiddenError()
  }
}

export function uniquePermissions<Permission extends string>(
  permissions: readonly Permission[]
): Permission[] {
  return Array.from(new Set(permissions))
}
