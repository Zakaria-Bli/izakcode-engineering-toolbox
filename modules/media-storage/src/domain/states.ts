export const MediaAssetStatus = {
  PENDING_UPLOAD: "pending_upload",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
  DELETED: "deleted",
} as const

export type MediaAssetStatus = (typeof MediaAssetStatus)[keyof typeof MediaAssetStatus]

export const MediaUploadSessionStatus = {
  AWAITING: "awaiting",
  PROCESSING: "processing",
  COMPLETED: "completed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  FAILED: "failed",
} as const

export type MediaUploadSessionStatus =
  (typeof MediaUploadSessionStatus)[keyof typeof MediaUploadSessionStatus]

export const DefaultMediaAssetKind = {
  IMAGE: "image",
  FILE: "file",
} as const

export type DefaultMediaAssetKind =
  (typeof DefaultMediaAssetKind)[keyof typeof DefaultMediaAssetKind]
