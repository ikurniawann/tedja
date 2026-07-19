import { createBrowserClient } from "@/lib/pg/browser-client";
import type { Candidate } from "@/types";
import type {
  CandidateListParams,
  CandidateListResult,
  CandidateBrand,
  CreateCandidatePayload,
  CandidateView,
  CandidateActivity,
  CandidateNote,
  CandidateDetailResult,
  CandidateAnalyticsResult,
  ChartDatum,
} from "./types";

const ACTIVE_PIPELINE = ["applied", "screening", "psikotes", "interview", "offer"];

export async function fetchCandidateList(
  params: CandidateListParams
): Promise<CandidateListResult> {
  const db = createBrowserClient();
  const { status, brand_id, position_id, search, date_from, date_to, page, perPage } = params;

  let query = db
    .from("candidates")
    .select(
      "id, full_name, email, phone, domicile, status, source, created_at, updated_at, brand_id, position_id, brands(name), positions(title)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (status) query = query.eq("status", status);
  if (brand_id) query = query.eq("brand_id", brand_id);
  if (position_id) query = query.eq("position_id", position_id);
  if (date_from) query = query.gte("created_at", date_from);
  if (date_to) query = query.lte("created_at", date_to + "T23:59:59");
  if (search) {
    query = query.or(
      `full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const { data, count } = await query;
  return { data: (data as unknown as Candidate[]) ?? [], count: count ?? 0 };
}

export async function fetchCandidateBrands(): Promise<CandidateBrand[]> {
  const db = createBrowserClient();
  const { data } = await db.from("brands").select("*").eq("is_active", true);
  return (data as CandidateBrand[]) ?? [];
}

export async function fetchCandidatesForExport(
  filter: Pick<CandidateListParams, "status" | "brand_id" | "search">
) {
  const db = createBrowserClient();
  let query = db
    .from("candidates")
    .select("*, brands(name), positions(title)")
    .order("created_at", { ascending: false });

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.brand_id) query = query.eq("brand_id", filter.brand_id);
  if (filter.search) {
    query = query.or(
      `full_name.ilike.%${filter.search}%,email.ilike.%${filter.search}%,phone.ilike.%${filter.search}%`
    );
  }

  const { data } = await query;
  return data ?? [];
}

export async function createCandidate(payload: CreateCandidatePayload, cvFile?: File | null) {
  const db = createBrowserClient();
  const { data: newCandidate, error } = await db
    .from("candidates")
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (cvFile && newCandidate) {
    const formData = new FormData();
    formData.append("file", cvFile);
    const res = await fetch(`/api/candidates/${newCandidate.id}/cv-upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      console.error("CV upload failed:", result.error);
    }
  }

  return newCandidate;
}

export async function deleteCandidate(id: string) {
  const db = createBrowserClient();
  const { error } = await db.from("candidates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchCandidateDetail(id: string): Promise<CandidateDetailResult> {
  const db = createBrowserClient();

  const { data: candidateData, error: candidateError } = await db
    .from("candidates")
    .select("*")
    .eq("id", id)
    .single();

  if (candidateError) throw new Error(candidateError.message);
  if (!candidateData) return { candidate: null, activities: [], notes: [] };

  let brandData: { name: string } | null = null;
  let positionData: { title: string } | null = null;

  if (candidateData.brand_id) {
    const { data: brand } = await db
      .from("brands")
      .select("name")
      .eq("id", candidateData.brand_id)
      .single();
    brandData = brand;
  }

  if (candidateData.position_id) {
    const { data: position } = await db
      .from("positions")
      .select("title")
      .eq("id", candidateData.position_id)
      .single();
    positionData = position;
  }

  const candidate = {
    ...candidateData,
    brands: brandData ? { name: brandData.name } : null,
    positions: positionData ? { title: positionData.title } : null,
  } as CandidateView;

  let activities: CandidateActivity[] = [];
  let notes: CandidateNote[] = [];

  try {
    const { data: activitiesData } = await db
      .from("candidate_activities")
      .select("*")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false });
    if (activitiesData) activities = activitiesData;
  } catch {
    activities = [];
  }

  try {
    const { data: notesData } = await db
      .from("candidate_notes")
      .select("*")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false });
    if (notesData) notes = notesData;
  } catch {
    notes = [];
  }

  return { candidate, activities, notes };
}

export async function updateCandidateStatus(id: string, status: string, _description?: string) {
  // endpoint stage mencatat jejak (siapa + dari-ke) secara otomatis
  const res = await fetch(`/api/candidates/${id}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal mengubah status");
}

export async function addCandidateNote(id: string, content: string): Promise<CandidateNote> {
  const res = await fetch(`/api/candidates/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal menyimpan catatan");
  return json.data as CandidateNote;
}

export async function fetchAnalyticsBrands(): Promise<CandidateBrand[]> {
  const db = createBrowserClient();
  const { data } = await db.from("brands").select("id, name").eq("is_active", true);
  return (data as CandidateBrand[]) ?? [];
}

function toChartData(counts: Record<string, number>, limit: number): ChartDatum[] {
  return Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function fetchCandidateAnalytics(
  brandFilter: string
): Promise<CandidateAnalyticsResult> {
  const db = createBrowserClient();
  let query = db.from("candidates").select("*, positions(title, brands(name))");
  if (brandFilter !== "all") query = query.eq("brand_id", brandFilter);
  const { data } = await query;
  const candidates = data ?? [];

  const now = new Date();
  const thisMonth = candidates.filter((c) => {
    const created = new Date(c.created_at);
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;

  const activePipeline = candidates.filter((c) => ACTIVE_PIPELINE.includes(c.status)).length;
  const talentPool = candidates.filter((c) => c.status === "talent_pool").length;

  const weeklyData: { name: string; candidates: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date();
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const count = candidates.filter((c) => {
      const d = new Date(c.created_at);
      return d >= start && d <= end;
    }).length;
    weeklyData.push({
      name: start.toLocaleDateString("id-ID", { month: "short", day: "numeric" }),
      candidates: count,
    });
  }

  const sources: Record<string, number> = {};
  candidates.forEach((c) => {
    sources[c.source] = (sources[c.source] || 0) + 1;
  });
  const sourceData = toChartData(sources, 6);

  const funnelData = [
    { stage: "Applied", count: candidates.filter((c) => c.status === "applied").length },
    { stage: "Screening", count: candidates.filter((c) => c.status === "screening").length },
    { stage: "Psikotes", count: candidates.filter((c) => c.status === "psikotes").length },
    { stage: "Interview", count: candidates.filter((c) => c.status === "interview").length },
    { stage: "Offer", count: candidates.filter((c) => c.status === "offer").length },
    { stage: "Hired", count: candidates.filter((c) => c.status === "hired").length },
    { stage: "Talent Pool", count: candidates.filter((c) => c.status === "talent_pool").length },
  ];

  const brandCounts: Record<string, number> = {};
  candidates.forEach((c) => {
    const brandName = c.positions?.brands?.name || "Unknown";
    brandCounts[brandName] = (brandCounts[brandName] || 0) + 1;
  });
  const brandData = toChartData(brandCounts, 5);

  const positionCounts: Record<string, number> = {};
  candidates.forEach((c) => {
    const posTitle = c.positions?.title || "Unknown";
    positionCounts[posTitle] = (positionCounts[posTitle] || 0) + 1;
  });
  const positionData = toChartData(positionCounts, 5);

  return {
    summary: { thisMonth, activePipeline, talentPool, openPositions: 0 },
    weeklyData,
    sourceData,
    funnelData,
    brandData,
    positionData,
  };
}
