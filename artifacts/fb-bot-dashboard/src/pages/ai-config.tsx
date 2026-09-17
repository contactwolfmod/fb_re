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

const STORAGE_KEY = "gemini_connected";

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
      toast({ title: "\u0110\u00e3 k\u1ebft n\u1ed1i Gemini \u2713", description: "Bot s\u1eb5n s\u00e0ng s\u1eed d\u1ee5ng AI." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  function openConnectPopup() {
    const redirectUrl = window.location.origin + "/ai-config";
    const url = `/connect/gemini?redirect=${encodeURIComponent(redirectUrl)}`;
    const popup = window.open(url, "gemini-connect", "width=500,height=680,resizable=no,scrollbars=yes");
    if (!popup) {
      window.location.href = url;
      return;
    }
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
          const pu = new URL(popupUrl);
          const model = pu.searchParams.get("model") ?? "";
          fetch("/api/bot/ai-config-status")
            .then((r) => r.ok ? r.json() : Promise.reject(r))
            .then((data) => {
              const next: ConnectedState = { connected: true, model: data.aiModel ?? model, baseUrl: data.aiBaseUrl ?? "" };
              setState(next);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              toast({ title: "\u0110\u00e3 k\u1ebft n\u1ed1i Gemini \u2713", description: `Model: ${next.model}` });
            })
            .catch(() => {
              const next: ConnectedState = { connected: true, model, baseUrl: "" };
              setState(next);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              toast({ title: "\u0110\u00e3 k\u1ebft n\u1ed1i Gemini \u2713", description: `Model: ${model}` });
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
        body: JSON.stringify({ baseUrl: "", apiKey: "", model: "" }),
      });
    } catch { /* ignore */ }
    const next: ConnectedState = { connected: false, model: "", baseUrl: "" };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    toast({ title: "\u0110\u00e3 ng\u1eaft k\u1ebft n\u1ed1i", description: "Bot s\u1ebd d\u00f9ng c\u1ea5u h\u00ecnh m\u1eb7c \u0111\u1ecbnh." });
  }

  async function handleTest() {
    setTesting(true);
    setTestError("");
    try {
      const res = await fetch("/api/bot/ai-config-status");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.aiBaseUrl || !data.aiApiKey) throw new Error("Ch\u01b0a c\u1ea5u h\u00ecnh base URL / API key");
      const testUrl = data.aiBaseUrl.replace(/\/+$/, "") + "/models";
      const r2 = await fetch(testUrl, { headers: { Authorization: "Bearer " + data.aiApiKey }, signal: AbortSignal.timeout(8000) });
      if (!r2.ok) throw new Error("HTTP " + r2.status);
      toast({ title: "K\u1ebft n\u1ed1i th\u00e0nh c\u00f4ng \u2713", description: data.aiBaseUrl });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setTestError(msg);
      toast({ title: "K\u1ebft n\u1ed1i th\u1ea5t b\u1ea1i", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">C\u1ea5u h\u00ecnh AI</h1>
        <p className="text-muted-foreground mt-1">
          K\u1ebft n\u1ed1i Google Gemini \u0111\u1ec3 bot t\u1ef1 \u0111\u1ed9ng tr\u1ea3 l\u1eddi tin nh\u1eafn. B\u1ea5m m\u1ed9t n\u00fat, kh\u00f4ng c\u1ea7n nh\u1eadp tay.
        </p>
      </div>
      {/* Main connect card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-blue-600 to-amber-500" />
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-amber-500 flex items-center justify-center shadow-lg shadow-blue-900/30">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            Google Gemini
          </CardTitle>
          <CardDescription>
            C\u1ea5p quy\u1ec1n m\u1ed9t l\u1ea7n qua Google OAuth. Bot t\u1ef1 \u0111\u1ed9ng d\u00f9ng Gemini \u0111\u1ec3 tr\u1ea3 l\u1eddi tin nh\u1eafn.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Status */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
            state.connected
              ? "bg-green-500/10 border-green-500/20"
              : "bg-muted/30 border-border/40"
          }`}>
            {state.connected ? (
              <svg className="w-5 h-5 text-green-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            ) : (
              <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            )}
            <div>
              {state.connected ? (
                <>
                  <p className="text-sm font-semibold text-green-400">\u0110\u00e3 k\u1ebft n\u1ed1i Gemini</p>
                  {state.model && <p className="text-xs text-muted-foreground mt-0.5">Model: {state.model}</p>}
                  {state.baseUrl && <p className="text-xs text-muted-foreground">URL: {state.baseUrl}</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Ch\u01b0a k\u1ebft n\u1ed1i. B\u1ea5m n\u00fat \u0111\u1ec3 b\u1eaft \u0111\u1ea7u.</p>
              )}
            </div>
            {state.connected && (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 ml-auto">Ho\u1ea1t \u0111\u1ed9ng</Badge>
            )}
          </div>

          {/* Scope list */}
          <div className="space-y-2">
            {[
              "G\u1ecdi API Gemini \u0111\u1ec3 t\u1ea1o ph\u1ea3n h\u1ed3i tin nh\u1eafn",
              "\u0110\u1ecdc danh s\u00e1ch model c\u00f3 s\u1eb5n t\u1eeb Google",
              "Kh\u00f4ng l\u01b0u tr\u1eef d\u1eef li\u1ec7u ng\u01b0\u1eddi d\u00f9ng",
            ].map((s) => (
              <div key={s} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
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
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />\u0110ang ki\u1ec3m tra...</>
                  : <><CheckCircle className="w-4 h-4 mr-2" />Ki\u1ec3m tra k\u1ebft n\u1ed1i</>}
              </Button>
              <Button onClick={openConnectPopup} variant="outline">
                <RefreshCcw className="w-4 h-4 mr-2" />
                K\u1ebft n\u1ed1i l\u1ea1i
              </Button>
              <Button onClick={handleDisconnect} variant="ghost" className="text-muted-foreground hover:text-destructive">
                <Unlink className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              onClick={openConnectPopup}
              className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-600 to-amber-500 hover:from-blue-700 hover:to-amber-600 shadow-lg shadow-blue-900/30"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              K\u1ebft n\u1ed1i Google Gemini
            </Button>
          )}

          <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-400">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Sau khi b\u1ea5m, c\u1eeda s\u1ed5 x\u00e1c th\u1ef1c Google s\u1ebd hi\u1ec7n. \u0110\u0103ng nh\u1eadp Google, ch\u1ecdn model Gemini, xong.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Quick tips */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            M\u1eb9o c\u1ea5u h\u00ecnh
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>M\u1ed7i kh\u00e1ch h\u00e0ng t\u1ef1 \u0111\u0103ng nh\u1eadp Google v\u00e0 ch\u1ecdn model Gemini ri\u00eang t\u1ea1i trang <code className="bg-muted/30 px-1 rounded">/u/id</code>.</p>
          <p>Admin kh\u00f4ng c\u1ea7n c\u1ea5u h\u00ecnh model. H\u1ec7 th\u1ed1ng per-user t\u1ef1 \u0111\u1ed9ng.</p>
        </CardContent>
      </Card>
    </div>
  );
}