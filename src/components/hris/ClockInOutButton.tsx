"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock, MapPin, Loader2, CheckCircle2, XCircle, Keyboard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ClockInOutButtonProps {
  employeeId?: string;
  onClockInSuccess?: (data: any) => void;
  onClockOutSuccess?: (data: any) => void;
  variant?: "default" | "large";
}

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string;
}

export function ClockInOutButton({
  employeeId,
  onClockInSuccess,
  onClockOutSuccess,
  variant = "default",
}: ClockInOutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [lastAttendanceId, setLastAttendanceId] = useState<string | null>(null);
  const [hasClockedOut, setHasClockedOut] = useState(false);
  const [pendingAction, setPendingAction] = useState<"clock-in" | "clock-out" | null>(null);
  const [useManualLocation, setUseManualLocation] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const { toast } = useToast();

  // Pulihkan state absensi hari ini — tanpa ini, refresh halaman setelah
  // clock-in membuat tombol clock-out mati selamanya
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const params = new URLSearchParams({
      employee_id: employeeId || "me",
      date: today,
      limit: "1",
    });
    fetch(`/api/hris/attendance?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const record = json?.data?.[0];
        if (!record) return;
        if (!record.clock_out) {
          setLastAttendanceId(record.id);
        } else {
          setHasClockedOut(true);
        }
      })
      .catch(() => {});
  }, [employeeId]);

  const getLocation = useCallback((useManual: boolean = false): Promise<LocationData | null> => {
    return new Promise((resolve) => {
      if (useManual && manualLat && manualLng) {
        // Use manual coordinates
        resolve({
          latitude: parseFloat(manualLat),
          longitude: parseFloat(manualLng),
          accuracy: 0,
        });
        return;
      }

      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          console.warn("Geolocation error:", error);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }, [manualLat, manualLng]);

  const handleClockAction = async (action: "clock-in" | "clock-out") => {
    try {
      setIsLoading(true);

      // Get location for clock-in
      let locationData: LocationData | null = null;
      if (action === "clock-in") {
        locationData = await getLocation();
        setLocation(locationData);
        if (locationData) {
          setPendingAction(action);
          setShowLocationDialog(true);
          return;
        }
      }

      // Proceed without location dialog (clock-out or no GPS)
      await performClockAction(action, action === "clock-in" ? locationData : undefined);
    } catch (error) {
      console.error("Clock action error:", error);
      toast({
        title: "Error",
        description: "Gagal melakukan absensi. Silakan coba lagi.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const performClockAction = async (action: "clock-in" | "clock-out", locData?: LocationData | null) => {
    const response = await fetch("/api/hris/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        employee_id: employeeId,
        ...(action === "clock-in" && locData
          ? { clock_in_location: locData }
          : {}),
        ...(action === "clock-out" && lastAttendanceId
          ? { attendance_id: lastAttendanceId }
          : {}),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to process");
    }

    if (action === "clock-in") {
      setLastAttendanceId(result.data.id);
      onClockInSuccess?.(result.data);
      toast({
        title: "✅ Clock-in Berhasil",
        description: `Waktu: ${new Date().toLocaleTimeString("id-ID")}${locData ? " 📍 Lokasi tercatat" : ""}`,
      });
    } else {
      setLastAttendanceId(null);
      setHasClockedOut(true);
      onClockOutSuccess?.(result.data);
      toast({
        title: "✅ Clock-out Berhasil",
        description: `Waktu: ${new Date().toLocaleTimeString("id-ID")}`,
      });
    }

    setShowLocationDialog(false);
  };

  const confirmLocation = () => {
    if (pendingAction) {
      performClockAction(pendingAction, location);
      setPendingAction(null);
    }
  };

  const cancelLocation = () => {
    setShowLocationDialog(false);
    setLocation(null);
    setPendingAction(null);
  };

  const sizeClasses = variant === "large" 
    ? "h-14 px-8 text-lg" 
    : "h-10 px-4";

  return (
    <>
      <div className="flex items-center gap-3">
        <Button
          onClick={() => handleClockAction("clock-in")}
          disabled={isLoading || !!lastAttendanceId || hasClockedOut}
          className={`${sizeClasses} bg-green-600 hover:bg-green-700`}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Clock className="w-4 h-4 mr-2" />
          )}
          Clock In
        </Button>

        <Button
          onClick={() => handleClockAction("clock-out")}
          disabled={isLoading || !lastAttendanceId}
          variant="outline"
          className={sizeClasses}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Clock className="w-4 h-4 mr-2" />
          )}
          Clock Out
        </Button>

        {hasClockedOut && (
          <Badge variant="outline" className="text-green-700">
            Absensi hari ini selesai
          </Badge>
        )}
      </div>

      {/* Location Confirmation Dialog */}
      <Dialog open={showLocationDialog} onOpenChange={setShowLocationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Lokasi Clock-In</DialogTitle>
            <DialogDescription>
              Kami akan mencatat lokasi Anda saat clock-in untuk keperluan absensi.
            </DialogDescription>
          </DialogHeader>

          {!location && !useManualLocation && (
            <div className="space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                <div className="flex items-start gap-2">
                  <XCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800">
                      Lokasi tidak tersedia
                    </p>
                    <p className="text-sm text-yellow-700 mt-1">
                      GPS tidak dapat diakses. Silakan gunakan lokasi manual atau coba lagi.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => setUseManualLocation(true)}
                className="w-full"
              >
                <Keyboard className="w-4 h-4 mr-2" />
                Input Lokasi Manual
              </Button>
            </div>
          )}

          {useManualLocation && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                <div className="flex items-start gap-2">
                  <MapPin className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">
                      Input Lokasi Manual
                    </p>
                    <p className="text-sm text-blue-700 mt-1">
                      Masukkan koordinat GPS secara manual. Contoh: -6.2088, 106.8456 (Jakarta)
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="latitude">Latitude</Label>
                  <Input
                    id="latitude"
                    type="number"
                    step="any"
                    placeholder="-6.2088"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="longitude">Longitude</Label>
                  <Input
                    id="longitude"
                    type="number"
                    step="any"
                    placeholder="106.8456"
                    value={manualLng}
                    onChange={(e) => setManualLng(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setUseManualLocation(false);
                    setManualLat("");
                    setManualLng("");
                  }}
                  className="flex-1"
                >
                  Batal
                </Button>
                <Button
                  onClick={() => {
                    if (manualLat && manualLng) {
                      setLocation({
                        latitude: parseFloat(manualLat),
                        longitude: parseFloat(manualLng),
                        accuracy: 0,
                      });
                      setUseManualLocation(false);
                    }
                  }}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={!manualLat || !manualLng}
                >
                  Gunakan Lokasi Ini
                </Button>
              </div>
            </div>
          )}

          {location && (
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium">Lokasi Tercatat:</span>
              </div>
              <div className="text-sm text-muted-foreground ml-6">
                <p>Latitude: {location.latitude.toFixed(6)}</p>
                <p>Longitude: {location.longitude.toFixed(6)}</p>
                <p>Akurasi: {location.accuracy > 0 ? `±${Math.round(location.accuracy)} meter` : 'Manual'}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={cancelLocation}>
              Batal
            </Button>
            <Button onClick={confirmLocation} className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Konfirmasi Clock-In
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
