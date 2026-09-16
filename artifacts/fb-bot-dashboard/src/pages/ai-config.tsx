import React, { useState, useEffect, useCallback } from "react";
import {
  Zap, CheckCircle, XCircle, Loader2, RefreshCcw,
  Globe, Cpu, Unlink, ExternalLink, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface ConnectedState {
  connected: boolean;
  model: string;
  baseUrl: string;
}

const STORAGE_KEY = "ninerouter_connected";

function loadState(): ConnectedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ConnectedState;
  } catch { /* ignore */ }
  return { connected: false, model: "", baseUrl: "" };
}

export default function AiConfig() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [state, setState] = useState<ConnectedState>(loadState);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");

  // Detect ?connected=1 callback from OAuth flow
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      const model = params.get("model") ?? "";
      // Fetch current botState to get baseUrl
      fetch("/api/bot/ai-config-status")
        .then((r) => r.ok ? r.json() : Promise.reject(r))
        .then((data) => {
          const next: ConnectedState = { connected: true, model: data.aiModel ?? model, baseUrl: data.aiBaseUrl ?? "" };
          setState(next);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        })
        .catch(() => {
          const next: ConnectedState = { connected: true, model, baseUrl: "" };
          setState(next);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        });
      toast({ title: "Da ket noi 9Router ✓", description: "Bot san sang su dung AI." });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  function openConnectPopup() {
    const redirectUrl = window.location.origin + "/ai-config";
    const url = `/connect/9router?redirect=${encodeURIComponent(redirectUrl)}`;
    const popup = window.open(url, "9router-connect", "width=500,height=680,resizable=no,scrollbars=yes");
    if (!popup) {
      // Fallback: navigate directly
      window.location.href = url;
      return;
    }
    // Poll popup for redirect back
    const timer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          return;
        }
        const popupUrl = popup.location.href;
        if (popupUrl.includes("connected=1")) {
          clearInterval(timer);
          popup.close();
          // Parse from popup URL
          const pu = new URL(popupUrl);
          const model = pu.searchParams.get("model") ?? "";
          fetch("/api/bot/ai-config-status")
            .then((r) => r.ok ? r.json() : Promise.reject(r))
            .then((data) => {
              const next: ConnectedState = { connected: true, model: data.aiModel ?? model, baseUrl: data.aiBaseUrl ?? "" };
              setState(next);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              toast({ title: "Da ket noi 9Router ✓", description: `Model: ${next.model}` });
            })
            .catch(() => {
              const next: ConnectedState = { connected: true, model, baseUrl: "" };
              setState(next);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              toast({ title: "Da ket noi 9Router ✓", description: `Model: ${model}` });
            });
        }
      } catch {
        // cross-origin: ignore until redirect back to same origin
      }
    }, 500);
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/bot/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "", apiKey: "", model: "cc/claude-opus-4-5-20251101" }),
      });
    } catch { /* ignore */ }
    const next: ConnectedState = { connected: false, model: "", baseUrl: "" };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    toast({ title: "Da ngat ket noi", description: "Bot se dung cau hinh env mac dinh." });
  }

  async function handleTest() {
    setTesting(true);
    setTestError("");
    try {
      const res = await fetch("/api/bot/ai-config-status");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.aiBaseUrl || !data.aiApiKey) throw new Error("Chua cau hinh base URL / API key");
      const testUrl = data.aiBaseUrl.replace(/\/+$/, "") + "/models";
      const r2 = await fetch(testUrl, { headers: { Authorization: "Bearer " + data.aiApiKey }, signal: AbortSignal.timeout(8000) });
      if (!r2.ok) throw new Error("HTTP " + r2.status);
      toast({ title: "Ket noi thanh cong ✓", description: data.aiBaseUrl });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setTestError(msg);
      toast({ title: "Ket noi that bai", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Config</h1>
        <p className="text-muted-foreground mt-1">
          Ket noi 9Router de bot tu dong goi AI. Bam mot nut, khong can nhap tay.
        </p>
      </div>

      {/* Main connect card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-violet-600 to-indigo-600" />
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-900/30">
              <Zap className="w-5 h-5 text-white" />
            </div>
            9Router AI Gateway
          </CardTitle>
          <CardDescription>
            Cap quyen mot lan. Bot tu dong dung 9Router de tra loi inbox ca nhan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Status */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
            state.connected
              ? "bg-green-500/10 border-green-500/20"
              : "bg-muted/30 border-border/40"
          }`}>
            {state.connected
              ? <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
              : <Globe className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              {state.connected ? (
                <>
                  <p className="text-sm font-semibold text-green-400">Da ket noi 9Router</p>
                  {state.model && <p className="text-xs text-muted-foreground font-mono truncate">Model: {state.model}</p>}
                  {state.baseUrl && <p className="text-xs text-muted-foreground font-mono truncate">{state.baseUrl}</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Chua ket noi. Bam nut de bat dau.</p>
              )}
            </div>
            {state.connected && (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 ml-auto">Active</Badge>
            )}
          </div>

          {/* Scope list */}
          <div className="space-y-2">
            {[
              "Goi API AI de tao phan hoi tin nhan",
              "Doc danh sach model co san tu 9Router",
              "Khong luu tru du lieu nguoi dung",
            ].map((s) => (
              <div key={s} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-violet-500 flex-shrink-0" />
                {s}
              </div>
            ))}
          </div>

          {testError && (
            <Alert className="bg-red-500/10 border-red-500/20 text-red-400">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="text-xs font-mono break-all">{testError}</AlertDescription>
            </Alert>
          )}

          {/* Action buttons */}
          {state.connected ? (
            <div className="flex gap-3">
              <Button onClick={handleTest} variant="secondary" disabled={testing} className="flex-1">
                {testing
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Dang kiem tra...</>
                  : <><CheckCircle className="w-4 h-4 mr-2" />Kiem tra ket noi</>}
              </Button>
              <Button onClick={openConnectPopup} variant="outline">
                <RefreshCcw className="w-4 h-4 mr-2" />
                Ket noi lai
              </Button>
              <Button onClick={handleDisconnect} variant="ghost" className="text-muted-foreground hover:text-destructive">
                <Unlink className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              onClick={openConnectPopup}
              className="w-full h-12 text-base font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-lg shadow-violet-900/30"
            >
              <Zap className="w-5 h-5 mr-2" />
              Ket noi 9Router
            </Button>
          )}

          <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-400">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Sau khi bam, cua so xac thuc se hien. Nhap API Key tu dashboard 9Router, bam Cap quyen. Xong.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Quick tips */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            Cau hinh nhanh
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Base URL 9Router tren Railway:</p>
          <code className="block bg-muted/30 border border-border/40 rounded-md px-3 py-2 text-xs font-mono">
            http://9router.railway.internal:20128/v1
          </code>
          <p>Lay API Key tai dashboard 9Router (tab Tokens / API Keys).</p>
        </CardContent>
      </Card>
    </div>
  );
}