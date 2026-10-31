import { Suspense } from "react";
import { AuditTable } from "@/components/term/AuditTable";
export default function AuditPage() { return <Suspense fallback={<div className="pt-5 text-fg-4">loading…</div>}><AuditTable /></Suspense>; }
