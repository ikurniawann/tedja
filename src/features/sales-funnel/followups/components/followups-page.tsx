"use client";

import { CheckCircleIcon } from "@heroicons/react/24/outline";
import {
  CheckCircle2,
  Circle,
  Loader2,
  MessageCircle,
  Phone,
  StickyNote,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import {
  useActivities,
  useUpdateActivity,
} from "../../activities/queries";
import {
  ACTIVITY_TYPE_LABELS,
  isOverdue,
  type ActivityType,
  type SalesActivity,
} from "../../activities/types";

const TYPE_ICON: Record<ActivityType, typeof Phone> = {
  telepon: Phone,
  wa: MessageCircle,
  meeting: Users,
  catatan: StickyNote,
};

function formatDue(value: string): string {
  return new Date(value).toLocaleString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AgendaRow({
  activity,
  onToggle,
}: {
  activity: SalesActivity;
  onToggle: (activity: SalesActivity) => void;
}) {
  const Icon = TYPE_ICON[activity.activity_type];
  const overdue = isOverdue(activity);
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border p-3.5 ${
        overdue ? "border-red-200 bg-red-50/60" : "border-gray-200/80 bg-white"
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(activity)}
        title={activity.done_at ? "Tandai belum selesai" : "Tandai selesai"}
        className="mt-0.5 shrink-0"
      >
        {activity.done_at ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <Circle className="h-5 w-5 text-gray-300 hover:text-pink-500" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
            <Icon className="mr-1 h-3 w-3" />
            {ACTIVITY_TYPE_LABELS[activity.activity_type]}
          </Badge>
          {overdue ? (
            <Badge className="border-0 bg-red-100 font-semibold text-red-700">
              Terlambat
            </Badge>
          ) : null}
          {activity.reminder_sent_at ? (
            <span className="text-xs text-emerald-600">✓ WA terkirim</span>
          ) : null}
        </div>
        <p className="mt-1 text-sm font-medium text-gray-900">
          {activity.deal_title
            ? `${activity.deal_title} — ${activity.org_name ?? ""}`
            : (activity.org_name ?? "Lead")}
        </p>
        {activity.notes ? (
          <p className="mt-0.5 text-sm text-gray-600">{activity.notes}</p>
        ) : null}
        <p className="mt-1 text-xs text-gray-400">
          {activity.due_at ? `Jatuh tempo ${formatDue(activity.due_at)}` : "Tanpa tenggat"}
          {" · PJ: "}
          {activity.owner_name ?? "—"}
        </p>
      </div>
      {activity.pic_phone ? (
        <a
          href={`https://wa.me/${activity.pic_phone}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Chat WA ${activity.pic_name ?? "PIC"}`}
          className="mt-0.5 shrink-0 text-emerald-600 hover:text-emerald-700"
        >
          <MessageCircle className="h-5 w-5" />
        </a>
      ) : null}
    </li>
  );
}

export function SalesFollowupsPage() {
  const activitiesQuery = useActivities({ view: "today" });
  const updateMutation = useUpdateActivity();

  const activities = activitiesQuery.data ?? [];
  const overdueList = activities.filter((a) => isOverdue(a));
  const todayList = activities.filter((a) => !isOverdue(a));

  const toggleDone = (activity: SalesActivity) => {
    updateMutation.mutate({
      id: activity.id,
      values: { is_done: !activity.done_at },
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Follow-up Hari Ini</h1>
        <p className="mt-1 text-sm text-gray-500">
          Agenda lintas deal & lead — {activities.length} follow-up menunggu
          {overdueList.length > 0 ? `, ${overdueList.length} terlambat` : ""}.
        </p>
      </div>

      <PurchasingListSection
        icon={CheckCircleIcon}
        title="Agenda"
        description="Follow-up jatuh tempo hari ini; yang terlambat disorot merah. Pengingat WA otomatis terkirim ke penanggung jawab."
      >
        {activitiesQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat agenda...</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircleIcon className="mx-auto mb-4 h-12 w-12 text-emerald-300" />
            <p className="text-gray-500">
              Tidak ada follow-up jatuh tempo — semua beres! 🎉
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5 px-4 pb-4">
            {overdueList.map((activity) => (
              <AgendaRow key={activity.id} activity={activity} onToggle={toggleDone} />
            ))}
            {todayList.map((activity) => (
              <AgendaRow key={activity.id} activity={activity} onToggle={toggleDone} />
            ))}
          </ul>
        )}
      </PurchasingListSection>
    </div>
  );
}
