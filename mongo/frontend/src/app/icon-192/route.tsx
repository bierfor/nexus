import { ImageResponse } from "next/og";
import { BrandMarkOg } from "@/lib/brand-mark";

const size = { width: 192, height: 192 };

export function GET() {
  return new ImageResponse(<BrandMarkOg size={192} />, { ...size });
}
