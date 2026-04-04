import { ImageResponse } from "next/og";
import { BrandMarkOg } from "@/lib/brand-mark";

const size = { width: 512, height: 512 };

export function GET() {
  return new ImageResponse(<BrandMarkOg size={512} />, { ...size });
}
