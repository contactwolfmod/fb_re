import React, { useState } from "react";
import { 
  useSetIgnoreThread, 
  useClearConversation 
} from "@workspace/api-client-react";
import { ShieldBan, Trash2, Search, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Settings() {
  const { toast } = useToast();
  
  const [ignoreThreadId, setIgnoreThreadId] = useState("");
  const [clearThreadId, setClearThreadId] = useState("");

  const setIgnore = useSetIgnoreThread();
  const clearConv = useClearConversation();

  const handleIgnore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ignoreThreadId) return;
    
    setIgnore.mutate({ data: { threadId: ignoreThreadId, ignore: true } }, {
      onSuccess: () => {
        toast({ title: "Đã chặn Thread", description: `Bot sẽ không trả lời ${ignoreThreadId} nữa` });
        setIgnoreThreadId("");
      },
      onError: (err) => {
        toast({ title: "Lỗi", description: err.error, variant: "destructive" });
      }
    });
  };

  const handleClear = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clearThreadId) return;
    
    clearConv.mutate({ data: { threadId: clearThreadId } }, {
      onSuccess: () => {
        toast({ title: "Đã xóa bộ nhớ", description: `Đã xóa ngữ cảnh AI cho ${clearThreadId}` });
        setClearThreadId("");
      },
      onError: (err) => {
        toast({ title: "Lỗi", description: err.error, variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cài đặt Nâng cao</h1>
        <p className="text-muted-foreground mt-1">Quản lý chặn thread và bộ nhớ hội thoại AI.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldBan className="w-5 h-5 text-orange-500" />
              Chặn Thread
            </CardTitle>
            <CardDescription>Ngăn bot trả lời các cuộc hội thoại cụ thể</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-orange-500/10 border-orange-500/20 text-orange-500 mb-4">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Tìm Thread ID trong URL Messenger (vd: facebook.com/messages/t/<strong>123456789</strong>)
              </AlertDescription>
            </Alert>
            
            <form onSubmit={handleIgnore} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Dán Thread ID..." 
                  value={ignoreThreadId}
                  onChange={(e) => setIgnoreThreadId(e.target.value)}
                  className="pl-9 bg-background/50 font-mono text-sm"
                />
              </div>
              <Button type="submit" variant="secondary" disabled={!ignoreThreadId || setIgnore.isPending}>
                Chặn
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Xóa Bộ nhớ
            </CardTitle>
            <CardDescription>Xóa lịch sử hội thoại AI cho một thread cụ thể</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">
              Hữu ích khi bot bị lặp hoặc cần quên ngữ cảnh trước đó.
            </p>
            
            <form onSubmit={handleClear} className="flex gap-2">
              <Input 
                placeholder="Dán Thread ID..." 
                value={clearThreadId}
                onChange={(e) => setClearThreadId(e.target.value)}
                className="bg-background/50 font-mono text-sm"
              />
              <Button type="submit" variant="destructive" disabled={!clearThreadId || clearConv.isPending}>
                Xóa ngữ cảnh
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
