
import React, { useState } from "react";
import {
  Zap, CheckCircle, XCircle, Loader2, ExternalLink,
  KeyRound, Globe, Cpu, RefreshCcw, Save, Info, Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

type ConnectStatus = "idle" | "testing" | "ok" | "error";

const STORAGE_KEY = "ninerouter_ai_config";

const DEFAULT_CONFIG: AiConfig = {
  baseUrl: "http://localhost:20128/v1",
  apiKey: "",
  model: "cc/claude-opus-4-5-20251101",
  timeoutMs: 12000,
  maxTokens: 500,
};

function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

export default function AiConfig() {
  const { toast } = useToast();
  const [config, setConfig] = useState<AiConfig>(loadConfig);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("idle");
  const [connectError, setConnectError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  function set<K extends keyof AiConfig>(k: K, v: AiConfig[K]) {
    setConfig((prev) => ({ ...prev, [k]: v }));
  }

  async function handleConnect() {
    if (!config.baseUrl || !config.apiKey) {
      toast({ title: "Thiếu thông tin", description: "Vui lòng nhập Base URL và API Key.", variant: "destructive" });
      return;
    }
    setConnectStatus("testing");
    setConnectError("");
    setModels([]);
    try {
      const url = config.baseUrl.replace(/\/+$/, "") + "/models";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const ids: string[] = (data?.data ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
      setModels(ids);
      setConnectStatus("ok");
      toast({ title: "Kết nối thành công ✓", description: `Tìm thấy ${ids.length} model.` });
    } catch (err: any) {
      setConnectStatus("error");
      const msg = err?.message ?? String(err);
      setConnectError(msg);
      toast({ title: "Kết nối thất bại", description: msg, variant: "destructive" });
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      const res = await fetch("/api/bot/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          timeoutMs: config.timeoutMs,
          maxTokens: config.maxTokens,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Đã lưu ✓", description: "Cấu hình AI đã được áp dụng cho bot." });
    } catch (err: any) {
      toast({ title: "Lưu thất bại", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  const statusIcon = connectStatus === "idle"
    ? <Plug className="w-4 h-4 text-muted-foreground" />
    : connectStatus === "testing"
    ? <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
    : connectStatus === "ok"
    ? <CheckCircle className="w-4 h-4 text-green-400" />
    : <XCircle className="w-4 h-4 text-red-400" />;

  const statusBadge = connectStatus === "idle"
    ? <Badge variant="secondary">Chưa kết nối</Badge>
    : connectStatus === "testing"
    ? <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Đang thử...</Badge>
    : connectStatus === "ok"
    ? <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Đã kết nối</Badge>
    : <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Lỗi kết nối</Badge>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Config</h1>
        <p className="text-muted-foreground mt-1">
          Cấu hình kết nối 9Router. Nhấn <strong>Test kết nối</strong> rồi <strong>Lưu &amp; Áp dụng</strong>.
        </p>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/50 bg-card/50">
        {statusIcon}
        <span className="text-sm font-medium">Trạng thái 9Router</span>
        <div className="ml-auto flex items-center gap-2">
          {statusBadge}
          {connectStatus === "ok" && models.length > 0 && (
            <span className="text-xs text-muted-foreground">{models.length} models</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-400" />
              Kết nối 9Router
            </CardTitle>
            <CardDescription>
              Base URL và API Key từ dashboard 9Router.{" "}
              <a
                href="http://localhost:20128"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Mở 9Router <ExternalLink className="w-3 h-3" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-400">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Nếu 9Router chạy cùng Railway project, dùng:<br />
                <code className="font-mono">http://9router.railway.internal:20128/v1</code>
              </AlertDescription>
            </Alert>

            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input
                value={config.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
                placeholder="http://localhost:20128/v1"
                className="font-mono text-sm bg-background/50"
              />
            </div>

            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                value={config.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
                placeholder="sk-..."
                className="font-mono text-sm bg-background/50"
              />
            </div>

            <Button
              className="w-full"
              variant="secondary"
              onClick={handleConnect}
              disabled={connectStatus === "testing"}
            >
              {connectStatus === "testing" ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang kết nối...</>
              ) : (
                <><Zap className="w-4 h-4 mr-2" /> Test kết nối</>
              )}
            </Button>

            {connectStatus === "error" && (
              <Alert className="bg-red-500/10 border-red-500/20 text-red-400">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-xs font-mono break-all">{connectError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-purple-400" />
              Model &amp; Hiệu suất
            </CardTitle>
            <CardDescription>Chọn model và cấu hình tốc độ phản hồi.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Model</Label>
              {models.length > 0 ? (
                <select
                  value={config.model}
                  onChange={(e) => set("model", e.target.value)}
                  className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm font-mono ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <Input
                  value={config.model}
                  onChange={(e) => set("model", e.target.value)}
                  placeholder="cc/claude-opus-4-5-20251101"
                  className="font-mono text-sm bg-background/50"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Timeout (ms)</Label>
              <Input
                type="number"
                value={config.timeoutMs}
                onChange={(e) => set("timeoutMs", Number(e.target.value))}
                min={3000}
                max={60000}
                step={1000}
                className="bg-background/50"
              />
              <p className="text-xs text-muted-foreground">Khuyến nghị 10000–15000.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Max Tokens</Label>
              <Input
                type="number"
                value={config.maxTokens}
                onChange={(e) => set("maxTokens", Number(e.target.value))}
                min={100}
                max={4096}
                step={50}
                className="bg-background/50"
              />
              <p className="text-xs text-muted-foreground">Khuyến nghị 300–800.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {connectStatus === "ok" && models.length > 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Models có sẵn ({models.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {models.map((m) => (
                <button
                  key={m}
                  onClick={() => set("model", m)}
                  className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
                    config.model === m
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button className="flex-1 sm:flex-none" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang lưu...</>
          ) : (
            <><Save className="w-4 h-4 mr-2" /> Lưu &amp; Áp dụng cho Bot</>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={() => { setConfig(DEFAULT_CONFIG); setConnectStatus("idle"); setModels([]); }}
        >
          <RefreshCcw className="w-4 h-4 mr-2" />
          Reset
        </Button>
      </div>
    </div>
  );
}