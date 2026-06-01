"use client";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLessons } from "@/hooks/useAriaData";
import { cn } from "@/lib/utils";
import { BookOpen, Lightbulb } from "lucide-react";

export default function LessonsPage() {
  const { data: lessons, isLoading } = useLessons();

  return (
    <div className="flex flex-col h-full">
      <Header title="AI Lessons" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading…</div>
        )}

        {!isLoading && (!lessons || lessons.length === 0) && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 gap-3">
              <BookOpen className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No lessons learned yet</p>
              <p className="text-xs text-muted-foreground/60">ARIA extracts lessons from closed trades over time</p>
            </CardContent>
          </Card>
        )}

        {lessons && lessons.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {lessons.map((lesson, i) => (
              <Card key={lesson.id ?? i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 ring-1 ring-primary/20 shrink-0">
                      <Lightbulb className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">
                          Lesson #{i + 1}
                        </Badge>
                        {lesson.confidence != null && (
                          <Badge
                            variant={lesson.confidence >= 0.7 ? "profit" : lesson.confidence >= 0.4 ? "warning" : "muted"}
                            className="text-[10px]"
                          >
                            {(lesson.confidence * 100).toFixed(0)}% confidence
                          </Badge>
                        )}
                        {lesson.created_at && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {new Date(lesson.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">{lesson.content}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
