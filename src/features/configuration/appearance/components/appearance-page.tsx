// src/features/configuration/appearance/components/appearance-page.tsx
"use client";

import { Check, Moon, Monitor, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HelpHint } from "@/components/ui/help-hint";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FadeIn } from "@/components/motion";
import { useTheme } from "@/components/providers/theme-provider";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { resolveBrand, type ThemeMode } from "@/lib/theme/theme-state";
import { cn } from "@/lib/utils";

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "auto", label: "Auto", icon: Monitor },
];

export function AppearancePage() {
  const { state, setState, setMode, reset } = useTheme();
  const brand = resolveBrand(state);

  return (
    <TooltipProvider>
      <FadeIn className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Tampilan</h1>
          <p className="text-sm text-muted-foreground">
            Sesuaikan tema warna dan mode terang/gelap aplikasi.
          </p>
        </div>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
            Mode <HelpHint helpId="appearance.mode" />
          </div>
          <div className="flex gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = state.mode === m.value;
              return (
                <Button
                  key={m.value}
                  variant={active ? "default" : "outline"}
                  onClick={() => setMode(m.value)}
                >
                  <Icon className="size-4" /> {m.label}
                </Button>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 text-sm font-medium">Preset Tema</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {THEME_PRESETS.map((p) => {
              const active =
                state.presetId === p.id &&
                !state.customPrimary &&
                !state.customSecondary;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setState({
                      ...state,
                      presetId: p.id,
                      customPrimary: null,
                      customSecondary: null,
                    })
                  }
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all hover:-translate-y-0.5",
                    active && "ring-2 ring-primary"
                  )}
                >
                  <span
                    className="size-8 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, ${p.primary}, ${p.secondary})`,
                    }}
                  />
                  <span className="text-sm font-medium">{p.label}</span>
                  {active && (
                    <Check className="absolute right-2 top-2 size-4 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
            Warna Kustom <HelpHint helpId="appearance.custom" />
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
              Primary
              <input
                type="color"
                value={brand.primary}
                onChange={(e) =>
                  setState({ ...state, customPrimary: e.target.value })
                }
                className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-transparent"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
              Secondary
              <input
                type="color"
                value={brand.secondary}
                onChange={(e) =>
                  setState({ ...state, customSecondary: e.target.value })
                }
                className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-transparent"
              />
            </label>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button variant="outline" onClick={reset}>
            Reset ke Default
          </Button>
        </div>
      </FadeIn>
    </TooltipProvider>
  );
}
