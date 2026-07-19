"use client";

import { useMemo, useState } from "react";
import type { Candidate, PipelineStage } from "@/types";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Clock,
  ExternalLink,
  Mail,
  Phone,
  Search,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PIPELINE_STAGES,
  FUNNEL_ORDER,
  funnelIndex,
} from "@/lib/recruitment/status";
import { usePipelineCandidates, usePipelineBrands } from "../queries";
import { useUpdateCandidateStage } from "../mutations";
import { AppliedActionPanel } from "./applied-action-panel";
import { ScreeningActionPanel } from "./screening-action-panel";
import { PsikotesActionPanel } from "./psikotes-action-panel";
import { InterviewActionPanel } from "./interview-action-panel";
import { OfferActionPanel } from "./offer-action-panel";
import { StageStepper } from "./stage-stepper";

type PipelineCandidate = Candidate & {
  brands?: { name: string } | null;
  positions?: { title: string } | null;
};

function getDaysInStage(updatedAt: string): number {
  const diff = Math.abs(Date.now() - new Date(updatedAt).getTime());
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function PipelinePage() {
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const candidatesQuery = usePipelineCandidates();
  const brandsQuery = usePipelineBrands();
  const candidates = (candidatesQuery.data ?? []) as PipelineCandidate[];
  const brands = brandsQuery.data ?? [];

  const updateStageMutation = useUpdateCandidateStage();

  const filtered = useMemo(() => {
    let list = candidates;
    if (selectedBrand !== "all") list = list.filter((c) => c.brand_id === selectedBrand);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.positions?.title?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [candidates, selectedBrand, search]);

  // selectedCandidate diambil dari cache supaya selalu fresh setelah mutasi
  const selectedCandidate = useMemo(
    () => filtered.find((c) => c.id === selectedId) ?? candidates.find((c) => c.id === selectedId) ?? null,
    [filtered, candidates, selectedId]
  );

  const byStage = useMemo(() => {
    const map = new Map<PipelineStage, PipelineCandidate[]>();
    for (const s of PIPELINE_STAGES) map.set(s.id, []);
    for (const c of filtered) {
      const bucket = map.get(c.status as PipelineStage);
      if (bucket) bucket.push(c);
    }
    return map;
  }, [filtered]);

  const totalActive = FUNNEL_ORDER.reduce(
    (acc, s) => acc + (byStage.get(s)?.length ?? 0),
    0
  );

  const handleDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index)
      return;
    updateStageMutation.mutate({
      id: draggableId,
      status: destination.droppableId as PipelineStage,
    });
  };

  const moveSelected = (status: PipelineStage) => {
    if (!selectedCandidate || selectedCandidate.status === status) return;
    updateStageMutation.mutate({ id: selectedCandidate.id, status });
  };

  const currentStageMeta = selectedCandidate
    ? PIPELINE_STAGES.find((s) => s.id === selectedCandidate.status)
    : null;
  const currentFunnelIdx = selectedCandidate ? funnelIndex(selectedCandidate.status) : -1;
  const prevStage = currentFunnelIdx > 0 ? FUNNEL_ORDER[currentFunnelIdx - 1] : null;
  const nextStage =
    currentFunnelIdx >= 0 && currentFunnelIdx < FUNNEL_ORDER.length - 1
      ? FUNNEL_ORDER[currentFunnelIdx + 1]
      : null;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Rekrutmen</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tarik & lepas kandidat antar tahapan, atau klik kartu untuk detail & action.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kandidat…"
              className="h-9 w-56 pl-9 text-sm"
            />
          </div>
          <Select value={selectedBrand} onValueChange={setSelectedBrand}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue placeholder="Semua Brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Brand</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Progress funnel ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Users className="size-4 text-gray-400" />
            {totalActive} kandidat di funnel aktif
          </span>
        </div>
        <div className="flex w-full overflow-hidden rounded-full">
          {FUNNEL_ORDER.map((stageId) => {
            const stage = PIPELINE_STAGES.find((s) => s.id === stageId)!;
            const count = byStage.get(stageId)?.length ?? 0;
            const pct = totalActive > 0 ? (count / totalActive) * 100 : 0;
            return (
              <div
                key={stageId}
                title={`${stage.label}: ${count}`}
                style={{ width: totalActive > 0 ? `${Math.max(pct, count > 0 ? 4 : 0)}%` : `${100 / FUNNEL_ORDER.length}%` }}
                className={`h-2.5 ${count > 0 ? stage.badge.split(" ")[0].replace("100", "400") : "bg-gray-100"}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {PIPELINE_STAGES.map((stage) => {
            const count = byStage.get(stage.id)?.length ?? 0;
            return (
              <span key={stage.id} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className={`inline-block size-2 rounded-full ${stage.badge.split(" ")[0].replace("100", "400")}`} />
                {stage.label} <b className="text-gray-700">{count}</b>
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Kanban ── */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
          {PIPELINE_STAGES.map((stage) => {
            const stageCandidates = byStage.get(stage.id) ?? [];
            return (
              <Droppable droppableId={stage.id} key={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex w-[250px] flex-shrink-0 flex-col rounded-xl border-2 sm:w-[270px] ${stage.color} ${
                      snapshot.isDraggingOver ? "ring-2 ring-blue-400 ring-offset-1" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stage.badge}`}>
                        {stageCandidates.length}
                      </span>
                    </div>
                    <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2">
                      {stageCandidates.map((c, index) => {
                        const days = getDaysInStage(c.updated_at);
                        return (
                          <Draggable draggableId={c.id} index={index} key={c.id}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                onClick={() => {
                                  setSelectedId(c.id);
                                  setSheetOpen(true);
                                }}
                                className={`cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${
                                  dragSnapshot.isDragging ? "rotate-1 shadow-lg" : ""
                                } ${days > 14 ? "border-red-300" : days > 7 ? "border-amber-300" : ""}`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                                    {initials(c.full_name)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-gray-900">
                                      {c.full_name}
                                    </div>
                                    <div className="truncate text-xs text-gray-500">
                                      {c.positions?.title ?? "—"}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 flex items-center justify-between">
                                  <span className="truncate text-[11px] text-gray-400">
                                    {c.brands?.name ?? ""}
                                  </span>
                                  <span
                                    className={`flex items-center gap-1 text-[11px] ${
                                      days > 14
                                        ? "font-medium text-red-500"
                                        : days > 7
                                          ? "font-medium text-amber-500"
                                          : "text-gray-400"
                                    }`}
                                  >
                                    <Clock className="size-3" /> {days}h
                                  </span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                      {stageCandidates.length === 0 && (
                        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 py-6 text-xs text-gray-400">
                          Kosong
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {/* ── Drawer detail kandidat ── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl"
        >
          {selectedCandidate && (
            <>
              <SheetHeader className="border-b border-gray-100 p-5 pb-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                    {initials(selectedCandidate.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="truncate text-base">
                      {selectedCandidate.full_name}
                    </SheetTitle>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Briefcase className="size-3" />
                        {selectedCandidate.positions?.title ?? "Posisi belum diisi"}
                      </span>
                      {selectedCandidate.brands?.name && <span>{selectedCandidate.brands.name}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      {selectedCandidate.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3" /> {selectedCandidate.email}
                        </span>
                      )}
                      {selectedCandidate.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="size-3" /> {selectedCandidate.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  {currentStageMeta && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${currentStageMeta.badge}`}>
                      {currentStageMeta.label}
                    </span>
                  )}
                </div>
              </SheetHeader>

              <div className="space-y-5 p-5">
                {/* progres + navigasi stage */}
                <div className="rounded-xl border border-gray-200 p-4">
                  <h4 className="mb-3 text-sm font-semibold text-gray-800">Progres Pipeline</h4>
                  <StageStepper
                    status={selectedCandidate.status as PipelineStage}
                    onMove={moveSelected}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {prevStage && (
                      <Button size="sm" variant="outline" onClick={() => moveSelected(prevStage)}>
                        <ArrowLeft className="size-3.5" />
                        {PIPELINE_STAGES.find((s) => s.id === prevStage)?.label}
                      </Button>
                    )}
                    {nextStage && (
                      <Button size="sm" onClick={() => moveSelected(nextStage)}>
                        {PIPELINE_STAGES.find((s) => s.id === nextStage)?.label}
                        <ArrowRight className="size-3.5" />
                      </Button>
                    )}
                    <div className="ml-auto flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-pink-600 hover:bg-pink-50"
                        onClick={() => moveSelected("talent_pool")}
                        disabled={selectedCandidate.status === "talent_pool"}
                      >
                        Talent Pool
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => moveSelected("rejected")}
                        disabled={selectedCandidate.status === "rejected"}
                      >
                        Tolak
                      </Button>
                    </div>
                  </div>
                </div>

                {/* action panel per status */}
                {selectedCandidate.status === "applied" ? (
                  <AppliedActionPanel candidate={selectedCandidate} />
                ) : selectedCandidate.status === "screening" ? (
                  <ScreeningActionPanel
                    key={selectedCandidate.id}
                    candidate={selectedCandidate}
                    onMove={moveSelected}
                    moving={updateStageMutation.isPending}
                  />
                ) : selectedCandidate.status === "psikotes" ? (
                  <PsikotesActionPanel
                    key={selectedCandidate.id}
                    candidate={selectedCandidate}
                    onMove={moveSelected}
                    moving={updateStageMutation.isPending}
                  />
                ) : selectedCandidate.status === "interview" ? (
                  <InterviewActionPanel
                    key={selectedCandidate.id}
                    candidate={selectedCandidate}
                    onMove={moveSelected}
                    moving={updateStageMutation.isPending}
                  />
                ) : selectedCandidate.status === "offer" ? (
                  <OfferActionPanel
                    key={selectedCandidate.id}
                    candidate={selectedCandidate}
                    onMove={moveSelected}
                    moving={updateStageMutation.isPending}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                    <p className="text-sm text-gray-500">
                      Action untuk tahap{" "}
                      <b>{currentStageMeta?.label ?? selectedCandidate.status}</b> menyusul.
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Saat ini action panel tersedia untuk tahap Applied, Screening, Psikotes &amp;
                      Interview.
                    </p>
                  </div>
                )}

                <Link
                  href={`/dashboard/hris/candidates/${selectedCandidate.id}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Buka profil lengkap kandidat <ExternalLink className="size-3.5" />
                </Link>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
