"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SafeHtml } from "@/components/hris/SafeHtml";
import { VideoEmbed } from "@/components/hris/VideoEmbed";

/**
 * ESS → Pengumuman Perusahaan (/dashboard/me/pengumuman): feed pengumuman
 * yang menyasar karyawan (global/departemennya), buka detail = tandai baca.
 */

interface FeedItem {
  id: string;
  title: string;
  cover_image_url: string | null;
  video_provider: string | null;
  tags: string[];
  is_pinned: boolean;
  publish_at: string | null;
  created_at: string;
  is_read: boolean;
}

interface AnnouncementDetail extends FeedItem {
  body_html: string;
  video_id: string | null;
  created_by_name: string | null;
}

type ReadFilter = "all" | "unread" | "read";
type SortOrder = "newest" | "oldest";

function itemTime(item: FeedItem): number {
  return new Date(item.publish_at ?? item.created_at).getTime();
}

function coverSrc(path: string | null): string | null {
  return path ? `/api/hris/announcements/cover/${path}` : null;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function EssPengumumanPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AnnouncementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const unreadCount = useMemo(
    () => items.filter((it) => !it.is_read).length,
    [items]
  );

  // Filter (dibaca/belum) lalu urutkan; pengumuman disematkan tetap di atas.
  const visibleItems = useMemo(() => {
    const filtered = items.filter((it) =>
      readFilter === "unread" ? !it.is_read : readFilter === "read" ? it.is_read : true
    );
    return [...filtered].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      const diff = itemTime(b) - itemTime(a);
      return sortOrder === "newest" ? diff : -diff;
    });
  }, [items, readFilter, sortOrder]);

  const loadFeed = useCallback(() => {
    fetch("/api/hris/announcements/feed")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setItems(json?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  async function openDetail(item: FeedItem) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/hris/announcements/${item.id}`);
      const json = await res.json();
      if (res.ok) {
        setDetail(json.data);
        // Tandai dibaca (fire-and-forget), lalu perbarui badge lokal
        if (!item.is_read) {
          fetch(`/api/hris/announcements/${item.id}/read`, { method: "POST" }).catch(() => {});
          setItems((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, is_read: true } : it))
          );
        }
      }
    } catch {
      // abaikan
    } finally {
      setDetailLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <MegaphoneIcon className="h-6 w-6 text-pink-600" /> Pengumuman Perusahaan
        </h1>
        <p className="text-sm text-gray-500">Informasi & pengumuman terbaru dari perusahaan</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200/70 bg-white p-10 text-center shadow-sm">
          <MegaphoneIcon className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">Belum ada pengumuman.</p>
        </div>
      ) : (
        <>
          {/* Filter dibaca/belum + urutan tanggal */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-gray-200/70 bg-white p-0.5 shadow-sm">
              {(
                [
                  { key: "all", label: "Semua", count: items.length },
                  { key: "unread", label: "Belum dibaca", count: unreadCount },
                  { key: "read", label: "Sudah dibaca", count: items.length - unreadCount },
                ] as const
              ).map((tab) => {
                const active = readFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setReadFilter(tab.key)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      active ? "bg-pink-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                        active ? "bg-white/25 text-white" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/70 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm transition hover:border-pink-300 hover:text-pink-600"
              title="Ubah urutan tanggal"
            >
              {sortOrder === "newest" ? (
                <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpWideNarrow className="h-3.5 w-3.5" />
              )}
              {sortOrder === "newest" ? "Terbaru" : "Terlama"}
            </button>
          </div>

          {visibleItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
              <p className="text-sm text-gray-400">
                {readFilter === "unread"
                  ? "Semua pengumuman sudah dibaca. 🎉"
                  : "Tidak ada pengumuman pada filter ini."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visibleItems.map((item) => {
                const cover = coverSrc(item.cover_image_url);
                const read = item.is_read;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openDetail(item)}
                    className={`group flex flex-col overflow-hidden rounded-xl border text-left shadow-sm transition hover:shadow ${
                      read
                        ? "border-gray-200/70 bg-gray-50/50 hover:border-gray-300"
                        : "border-pink-200 bg-white ring-1 ring-pink-100 hover:border-pink-300"
                    }`}
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-pink-50 to-indigo-50">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cover}
                          alt=""
                          className={`h-full w-full object-cover transition ${
                            read ? "opacity-70 grayscale-[30%] group-hover:opacity-90" : ""
                          }`}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <MegaphoneIcon
                            className={`h-10 w-10 ${read ? "text-gray-200" : "text-pink-200"}`}
                          />
                        </div>
                      )}
                      <div className="absolute left-2 top-2 flex gap-1.5">
                        {item.is_pinned && (
                          <span className="rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
                            📌 Disematkan
                          </span>
                        )}
                        {read ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-900/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                            <CheckCircleIcon className="h-3 w-3" /> Dibaca
                          </span>
                        ) : (
                          <span className="rounded-full bg-pink-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            Baru
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <p
                        className={`line-clamp-2 ${
                          read ? "font-medium text-gray-500" : "font-semibold text-gray-900"
                        }`}
                      >
                        {item.title}
                      </p>
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="mt-auto text-xs text-gray-400">
                        {formatDate(item.publish_at ?? item.created_at)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <Dialog open={detail !== null || detailLoading} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          {detailLoading || !detail ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{detail.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-xs text-gray-400">
                  {formatDate(detail.publish_at ?? detail.created_at)}
                  {detail.created_by_name ? ` · oleh ${detail.created_by_name}` : ""}
                </p>
                {detail.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {coverSrc(detail.cover_image_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverSrc(detail.cover_image_url)!}
                    alt=""
                    className="w-full rounded-xl object-cover"
                  />
                )}
                <SafeHtml
                  html={detail.body_html}
                  className="prose prose-sm max-w-none text-gray-700 [&_a]:text-pink-600 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:text-gray-500"
                />
                <VideoEmbed provider={detail.video_provider} videoId={detail.video_id} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
