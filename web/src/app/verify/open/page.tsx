import { Suspense } from "react";
import { OpenIdApp } from "@/components/OpenIdApp";

export const metadata = { title: "Sentinel · Open Concordium ID" };
export default function OpenPage() { return <Suspense><OpenIdApp /></Suspense>; }
