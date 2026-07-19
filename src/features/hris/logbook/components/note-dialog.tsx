"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/hris/RichTextEditor";
import type { LogbookEntryItem } from "../types";

/**
 * Dialog catatan per item checklist — pengganti overlay Quill fullscreen.
 * HTML dirender di tempat lain lewat <SafeHtml> (sanitasi DOMPurify).
 */
export function LogbookNoteDialog({
  item,
  saving,
  onClose,
  onSave,
}: {
  item: LogbookEntryItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (itemId: string, notes: string) => void;
}) {
  const [draft, setDraft] = useState("");

  // Reset draft tiap ganti item agar catatan item lain tidak terbawa.
  useEffect(() => {
    setDraft(item?.notes || "");
  }, [item?.id, item?.notes]);

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Catatan — {item?.title}</DialogTitle>
        </DialogHeader>
        {item && (
          <RichTextEditor
            key={item.id}
            value={item.notes || ""}
            onChange={setDraft}
            placeholder="Tulis catatan checklist di sini..."
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button
            onClick={() => item && onSave(item.id, draft)}
            disabled={saving}
          >
            {saving ? "Menyimpan..." : "Simpan Catatan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
