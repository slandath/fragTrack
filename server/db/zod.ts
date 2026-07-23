import { z } from "zod";

export const FragranceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  brand: z.string().min(1).max(100),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const RetailerSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  url: z.url().min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const RetailerUrlSchema = z.object({
  id: z.uuid(),
  fragranceId: z.uuid(),
  retailerId: z.uuid(),
  url: z.url().min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Fragrance = z.infer<typeof FragranceSchema>;
export type Retailer = z.infer<typeof RetailerSchema>;
export type RetailerUrl = z.infer<typeof RetailerUrlSchema>;
