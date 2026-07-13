"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, User } from "lucide-react";

import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CustomerWithDiscount } from "@/hooks/use-pos-customers";
import { cn } from "@/lib/utils";

export type CreateCustomerPayload = {
  name: string;
  phone: string;
  email?: string;
  enroll_member: boolean;
  nfc_uid?: string;
};

interface Props {
  open: boolean;
  customers: CustomerWithDiscount[];
  search: string;
  selectedCustomerId: string | null;
  onSearchChange: (v: string) => void;
  onSelect: (customer: CustomerWithDiscount | null) => void;
  onCreateCustomer?: (payload: CreateCustomerPayload) => Promise<CustomerWithDiscount>;
  onClose: () => void;
  /** Prefill Card ID and open create form (unknown NFC scan). */
  initialNfcUid?: string | null;
  onInitialNfcUidConsumed?: () => void;
}

export function CustomerSearchModal({
  open,
  customers,
  search,
  selectedCustomerId,
  onSearchChange,
  onSelect,
  onCreateCustomer,
  onClose,
  initialNfcUid = null,
  onInitialNfcUidConsumed,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nfcUid, setNfcUid] = useState("");
  const [nfcUidLocked, setNfcUidLocked] = useState(false);
  const [enrollMember, setEnrollMember] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.nfc_uid || "").toLowerCase().includes(q)
    );
  }, [customers, search]);

  const resetCreateForm = () => {
    setShowCreate(false);
    setName("");
    setPhone("");
    setEmail("");
    setNfcUid("");
    setNfcUidLocked(false);
    setEnrollMember(true);
    setFormError("");
    setSaving(false);
  };

  useEffect(() => {
    if (!open) return;
    const uid = initialNfcUid?.trim();
    if (!uid) return;
    setShowCreate(true);
    setNfcUid(uid.toUpperCase());
    setNfcUidLocked(true);
    setEnrollMember(true);
    setFormError("");
    onInitialNfcUidConsumed?.();
  }, [open, initialNfcUid, onInitialNfcUidConsumed]);

  const openCreateForm = () => {
    const raw = search.trim();
    setShowCreate(true);
    setFormError("");
    setNfcUidLocked(false);
    if (/^[+\d\s-]+$/.test(raw)) setPhone(raw);
    else setName(raw);
  };

  const handleCreate = async () => {
    if (!onCreateCustomer) return;
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanNfcUid = nfcUid.trim().toUpperCase();

    if (!cleanName) {
      setFormError("Name is required");
      return;
    }

    if (!cleanPhone) {
      setFormError("Phone number is required");
      return;
    }

    try {
      setSaving(true);
      setFormError("");
      const customer = await onCreateCustomer({
        name: cleanName,
        phone: cleanPhone,
        email: email.trim() || undefined,
        enroll_member: enrollMember,
        nfc_uid: cleanNfcUid || undefined,
      });
      resetCreateForm();
      onSearchChange("");
      onSelect(customer);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to save customer"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          resetCreateForm();
          onClose();
        }
      }}
    >
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>
            {showCreate ? "Add customer" : "Select customer"}
          </DialogPanelTitle>
          <DialogPanelDescription>
            {showCreate
              ? "Create a walk-in customer or enroll them as a member."
              : "Search members, continue as guest, or add a new customer."}
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-4">
          {!showCreate ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by name, phone, or card ID…"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  autoFocus
                  className="h-11 border-gray-200/80 bg-white pl-10"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-4 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      Guest
                    </div>
                    <div className="text-xs text-muted-foreground">
                      No member discount or XP
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      Add customer
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Save to customer list
                    </div>
                  </div>
                </button>
              </div>

              {filtered.length === 0 && search.trim() ? (
                <button
                  type="button"
                  onClick={openCreateForm}
                  className="w-full rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  No matches. Add “{search.trim()}” as a new customer
                </button>
              ) : null}

              <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-0.5">
                {filtered.map((customer) => {
                  const selected = selectedCustomerId === customer.id;
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => onSelect(customer)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                        selected
                          ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                          : "border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5"
                      )}
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {customer.name?.charAt(0) || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {customer.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {customer.phone}
                          {customer.nfc_uid ? ` · Card ${customer.nfc_uid}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                            customer.membership_tier === "platinum"
                              ? "bg-violet-100 text-violet-700"
                              : customer.membership_tier === "gold"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-muted text-muted-foreground"
                          )}
                        >
                          {customer.membership_tier || "member"}
                        </span>
                        {customer.discount > 0 ? (
                          <div className="mt-1 text-[11px] font-medium text-emerald-600">
                            −{customer.discount}%
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {formError ? (
                <div className="rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {formError}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Name <span className="text-red-500">*</span>
                  </span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    placeholder="Customer name"
                    disabled={saving}
                    required
                    className="border-gray-200/80"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Phone <span className="text-red-500">*</span>
                  </span>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08xxxxxxxxxx"
                    disabled={saving}
                    required
                    className="border-gray-200/80"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">
                  Card ID{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                <Input
                  value={nfcUid}
                  onChange={(e) => setNfcUid(e.target.value.toUpperCase())}
                  placeholder="NFC / RFID UID"
                  disabled={saving || nfcUidLocked}
                  readOnly={nfcUidLocked}
                  className="border-gray-200/80 font-mono tracking-wide"
                />
                {nfcUidLocked ? (
                  <span className="text-xs text-muted-foreground">
                    Filled from the scanned card. Save to link this card to the member.
                  </span>
                ) : null}
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">
                  Email <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@domain.com"
                  disabled={saving}
                  className="border-gray-200/80"
                />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <input
                  type="checkbox"
                  checked={enrollMember}
                  onChange={(e) => setEnrollMember(e.target.checked)}
                  disabled={saving}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    Enroll as member
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Enables membership benefits and XP on purchases.
                  </span>
                </span>
              </label>
            </div>
          )}
        </DialogPanelBody>

        {showCreate ? (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => {
                if (nfcUidLocked) {
                  resetCreateForm();
                  onClose();
                  return;
                }
                setShowCreate(false);
              }}
              disabled={saving}
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="bg-primary hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save & select"
              )}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
