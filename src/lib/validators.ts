import { z } from 'zod';

// App-level validation gives friendly messages. The SAME rules are enforced again
// by CHECK constraints / triggers inside PostgreSQL (db/01_listing.sql and db/02_workflow.sql), which is the
// authoritative layer.
const phone = z.string().trim().regex(/^\+?[0-9]{10,13}$/, 'phone must be 10-13 digits');

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(8, 'at least 8 characters')
    .max(72, 'at most 72 characters')
    .regex(/[A-Za-z]/, 'must contain a letter')
    .regex(/[0-9]/, 'must contain a digit'),
  fullName: z.string().trim().min(2).max(100),
  phone,
  role: z.enum(['TENANT', 'OWNER']),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

export const inquirySchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  seenVersionId: z.coerce.number().int().positive(),
  message: z.string().trim().max(500).optional(),
});

export const escrowSchema = z.object({
  inquiryId: z.coerce.number().int().positive(),
  amount: z.coerce.number().min(100).max(100000),
  idempotencyKey: z.string().uuid().optional(),
});

export const checkinSchema = z.object({
  otp: z
    .string()
    .regex(/^[0-9]{6}$/, 'OTP is 6 digits')
    .optional(),
});

export const complaintSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  category: z.enum(['FAKE_LISTING', 'PRICE_CHANGE', 'DEPOSIT_DISPUTE', 'HARASSMENT', 'OTHER']),
  description: z.string().trim().min(10).max(1000),
});

export const reviewSchema = z.object({
  leaseId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const propertySchema = z.object({
  propertyType: z.enum(['APARTMENT', 'PG', 'ROOM', 'STUDIO']),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

export const leaseSchema = z.object({
  inquiryId: z.coerce.number().int().positive(),
  startDate: isoDate,
  endDate: isoDate,
});

export const listingSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  title: z.string().trim().min(3).max(120),
  monthlyRent: z.coerce.number().positive().max(10_000_000),
  securityDeposit: z.coerce.number().min(0).max(100_000_000),
  addressLine: z.string().trim().min(3).max(200),
  locality: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, 'pincode is 6 digits'),
  contactPhone: phone,
  amenities: z.string().max(300).optional(),
  effectiveFrom: isoDate,
});

export const flagReviewSchema = z.object({ status: z.enum(['CONFIRMED', 'DISMISSED']) });
export const complaintReviewSchema = z.object({ status: z.enum(['UNDER_REVIEW', 'RESOLVED', 'REJECTED']) });
export const verifySchema = z.object({ verified: z.boolean() });
