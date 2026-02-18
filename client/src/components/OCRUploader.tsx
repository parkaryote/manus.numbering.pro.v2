import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload, CheckCircle, AlertCircle } from "lucide-react";

interface OCRUploaderProps {
  onExtractedText?: (text: string) => void;
}

export function OCRUploader({ onExtractedText }: OCRUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "completed" | "failed">("idle");
  const [extractedText, setExtractedText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Start OCR job
  const startJobMutation = trpc.ocr.startJob.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
      setStatus("processing");
      setErrorMessage("");
    },
    onError: (error) => {
      setStatus("failed");
      setErrorMessage(error.message);
    },
  });

  // Poll job status
  const statusQuery = trpc.ocr.getStatus.useQuery(
    { jobId: jobId! },
    {
      enabled: jobId !== null && status === "processing",
      refetchInterval: 2000, // Poll every 2 seconds
      onSuccess: (data) => {
        if (data.status === "completed") {
          setExtractedText(data.extractedText || "");
          setStatus("completed");
          onExtractedText?.(data.extractedText || "");
        } else if (data.status === "failed") {
          setStatus("failed");
          setErrorMessage(data.errorMessage || "OCR processing failed");
        }
      },
      onError: (error) => {
        setStatus("failed");
        setErrorMessage(error.message);
      },
    }
  );

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setStatus("idle");
      setExtractedText("");
      setErrorMessage("");
      setJobId(null);
    }
  };

  // Upload file to S3 using tRPC
  const uploadFileMutation = trpc.ocr.uploadFile.useMutation({
    onSuccess: (data) => {
      // Start OCR job with S3 URL
      startJobMutation.mutate({
        s3Url: data.s3Url,
        fileName: file!.name,
      });
    },
    onError: (error) => {
      setStatus("failed");
      setErrorMessage(error.message);
    },
  });

  // Handle upload
  const handleUpload = async () => {
    if (!file) return;

    setStatus("uploading");

    try {
      // Read file as buffer and upload via tRPC
      const reader = new FileReader();
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        uploadFileMutation.mutate({
          fileBuffer: new Uint8Array(arrayBuffer),
          fileName: file.name,
          mimeType: file.type,
        });
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      setStatus("failed");
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    }
  };

  // Handle reset
  const handleReset = () => {
    setFile(null);
    setJobId(null);
    setStatus("idle");
    setExtractedText("");
    setErrorMessage("");
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          OCR 문서 인식
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File Input */}
        {status === "idle" && !file && (
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileSelect}
              className="hidden"
              id="ocr-file-input"
            />
            <label htmlFor="ocr-file-input" className="cursor-pointer">
              <div className="space-y-2">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">PDF 또는 이미지 파일을 선택하세요</p>
                <p className="text-xs text-muted-foreground">PDF, JPG, PNG 지원</p>
              </div>
            </label>
          </div>
        )}

        {/* File Selected */}
        {file && status === "idle" && (
          <div className="space-y-4">
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleUpload} className="flex-1">
                OCR 시작
              </Button>
              <Button onClick={handleReset} variant="outline">
                취소
              </Button>
            </div>
          </div>
        )}

        {/* Processing */}
        {status === "processing" && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="text-sm text-muted-foreground">문서를 인식 중입니다...</p>
          </div>
        )}

        {/* Completed */}
        {status === "completed" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              <p className="text-sm font-medium">OCR 완료</p>
            </div>
            <div className="bg-muted p-4 rounded-lg max-h-64 overflow-y-auto">
              <p className="text-sm whitespace-pre-wrap">{extractedText}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => onExtractedText?.(extractedText)} className="flex-1">
                이 텍스트로 문제 생성
              </Button>
              <Button onClick={handleReset} variant="outline">
                다시 시작
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "failed" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <p className="text-sm font-medium">오류 발생</p>
            </div>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Button onClick={handleReset} className="w-full">
              다시 시도
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
