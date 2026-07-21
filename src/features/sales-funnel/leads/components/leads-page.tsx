"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeleteLead, useLeads } from "../queries";
import { LeadFormDialog } from "./lead-form-dialog";
import { LeadImportDialog } from "./lead-import-dialog";
import {
  ORG_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  TEMPERATURE_LABELS,
  type LeadStatus,
  type LeadTemperature,
  type SalesLead,
} from "../types";

const ALL = "all";

const STATUS_BADGE: Record<LeadStatus, string> = {
  baru: "bg-blue-100 text-blue-700",
  dihubungi: "bg-amber-100 text-amber-700",
  qualified: "bg-emerald-100 text-emerald-700",
  "tidak-cocok": "bg-zinc-200 text-zinc-600",
};

const TEMPERATURE_BADGE: Record<LeadTemperature, string> = {
  panas: "bg-red-100 text-red-700",
  hangat: "bg-orange-100 text-orange-700",
  dingin: "bg-sky-100 text-sky-700",
};

export function SalesFunnelLeadsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [orgType, setOrgType] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<SalesLead | null>(null);
  const [deletingLead, setDeletingLead] = useState<SalesLead | null>(null);

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo(
    () => ({
      q: debouncedSearch,
      status: status === ALL ? "" : status,
      org_type: orgType === ALL ? "" : orgType,
      source: source === ALL ? "" : source,
      page,
    }),
    [debouncedSearch, status, orgType, source, page]
  );

  const { data, isLoading } = useLeads(filters);
  const deleteMutation = useDeleteLead();

  const leads = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const openCreate = () => {
    setEditingLead(null);
    setFormOpen(true);
  };
  const openEdit = (lead: SalesLead) => {
    setEditingLead(lead);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Prospek B2B — corporate, sekolah, komunitas & booking acara privat
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Tambah Lead
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Cari instansi / PIC / no. WA…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua Status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={orgType} onValueChange={(v) => { setOrgType(v); setPage(1); }}>
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder="Jenis Instansi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua Jenis</SelectItem>
            {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Sumber" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua Sumber</SelectItem>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instansi</TableHead>
              <TableHead>PIC</TableHead>
              <TableHead>Kota</TableHead>
              <TableHead>Sumber</TableHead>
              <TableHead>Suhu</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Penanggung Jawab</TableHead>
              <TableHead className="w-16 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Memuat…
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Belum ada lead. Tambah manual atau import CSV.
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <div className="font-medium">{lead.org_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {ORG_TYPE_LABELS[lead.org_type]}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{lead.pic_name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {lead.pic_phone}
                      <a
                        href={`https://wa.me/${lead.pic_phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Chat WA"
                        className="text-emerald-600 hover:text-emerald-700"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>{lead.city ?? "—"}</TableCell>
                  <TableCell>{SOURCE_LABELS[lead.source]}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={TEMPERATURE_BADGE[lead.temperature]}>
                      {TEMPERATURE_LABELS[lead.temperature]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={STATUS_BADGE[lead.status]}>
                      {STATUS_LABELS[lead.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{lead.owner_name ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md p-0 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Buka menu aksi</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(lead)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600"
                          onClick={() => setDeletingLead(lead)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Hapus
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.total > pagination.limit && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {pagination.total} lead — halaman {pagination.page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}

      <LeadFormDialog open={formOpen} onOpenChange={setFormOpen} lead={editingLead} />
      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={deletingLead !== null}
        onOpenChange={(open) => !open && setDeletingLead(null)}
        title="Hapus lead?"
        description={`Lead "${deletingLead?.org_name ?? ""}" akan dihapus. Tindakan ini tidak menghapus deal yang sudah dibuat.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deletingLead) deleteMutation.mutate(deletingLead.id);
          setDeletingLead(null);
        }}
      />
    </div>
  );
}
