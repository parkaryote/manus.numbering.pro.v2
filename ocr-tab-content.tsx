      <TabsContent value="ocr" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>파일 선택 (PDF, PPT, 이미지)</Label>
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <input
              id="ocr-file-input"
              type="file"
              accept=".pdf,.ppt,.pptx,image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setOcrFile(file);
                  setOcrExtractedText("");
                }
              }}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => document.getElementById("ocr-file-input")?.click()}
              disabled={ocrIsProcessing}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              {ocrFile ? ocrFile.name : "파일 선택"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              PDF, PPT, PPTX, PNG, JPG (최대 50MB)
            </p>
          </div>
        </div>

        {ocrFile && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>추출된 텍스트 검토</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOcrFile(null);
                  setOcrExtractedText("");
                }}
              >
                파일 제거
              </Button>
            </div>
            {ocrIsProcessing ? (
              <div className="border rounded-lg p-4 text-center text-muted-foreground">
                <div className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2"></div>
                OCR 처리 중...
              </div>
            ) : ocrExtractedText ? (
              <Textarea
                value={ocrExtractedText}
                onChange={(e) => setOcrExtractedText(e.target.value)}
                placeholder="추출된 텍스트가 여기에 표시됩니다"
                rows={8}
              />
            ) : (
              <Button
                type="button"
                onClick={async () => {
                  if (!ocrFile) return;
                  setOcrIsProcessing(true);
                  try {
                    const formData = new FormData();
                    formData.append("file", ocrFile);
                    const response = await fetch("/api/upload/document", {
                      method: "POST",
                      body: formData,
                    });
                    if (!response.ok) {
                      const error = await response.json();
                      throw new Error(error.error || "OCR 처리 실패");
                    }
                    const data = await response.json();
                    setOcrExtractedText(data.rawText);
                  } catch (error: any) {
                    toast.error(error.message || "OCR 처리 중 오류 발생");
                    setOcrFile(null);
                  } finally {
                    setOcrIsProcessing(false);
                  }
                }}
                className="w-full"
                disabled={ocrIsProcessing}
              >
                {ocrIsProcessing ? "처리 중..." : "OCR 처리"}
              </Button>
            )}
          </div>
        )}

        {ocrExtractedText && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ocr-auto-register"
                checked={ocrAutoRegister}
                onChange={(e) => setOcrAutoRegister(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 cursor-pointer"
              />
              <Label htmlFor="ocr-auto-register" className="cursor-pointer text-sm font-normal">
                검토 없이 바로 등록 (고급 옵션)
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {ocrAutoRegister
                ? "OCR 결과를 바로 문제로 등록합니다"
                : "텍스트 탭에서 수정 후 저장할 수 있습니다"}
            </p>
          </div>
        )}
      </TabsContent>
