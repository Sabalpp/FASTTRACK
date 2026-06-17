"use client";

import Chart from "chart.js/auto";
import { useEffect, useMemo, useRef } from "react";
import type { Job, JobStatus } from "@/lib/types";

const statusLabels: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled"
};

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay();
  next.setDate(next.getDate() + (day === 0 ? -6 : 1 - day));
  return next;
}

export function OperationsChart({ jobs }: { jobs: Job[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { series, statusRows, summary } = useMemo(() => {
    const firstDay = startOfWeek(new Date());

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(firstDay);
      date.setDate(firstDay.getDate() + index);
      return {
        key: dayKey(date),
        day: dayLabel(date),
        date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date),
        total: 0,
        scheduled: 0,
        in_progress: 0,
        complete: 0,
        cancelled: 0
      };
    });

    const byKey = new Map(days.map((day) => [day.key, day]));
    const statusCounts: Record<JobStatus, number> = {
      scheduled: 0,
      in_progress: 0,
      complete: 0,
      cancelled: 0
    };

    jobs.forEach((job) => {
      statusCounts[job.status] += 1;
      const row = byKey.get(dayKey(new Date(job.scheduledAt)));
      if (!row) return;
      row.total += 1;
      row[job.status] += 1;
    });

    const totalJobs = jobs.length;
    const openJobs = statusCounts.scheduled + statusCounts.in_progress;
    const completedJobs = statusCounts.complete;
    const completionRate = totalJobs === 0 ? 0 : Math.round((completedJobs / totalJobs) * 100);

    return {
      series: days,
      statusRows: (Object.entries(statusCounts) as [JobStatus, number][]).map(([status, count]) => ({
        status,
        label: statusLabels[status],
        count
      })),
      summary: {
        totalJobs,
        openJobs,
        completedJobs,
        completionRate
      }
    };
  }, [jobs]);

  const weekRange = `${series[0]?.date ?? ""} - ${series[series.length - 1]?.date ?? ""}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: series.map((day) => day.day),
        datasets: [
          {
            label: "Scheduled",
            data: series.map((day) => day.scheduled),
            backgroundColor: "#263846",
            borderRadius: 6,
            borderSkipped: false
          },
          {
            label: "In progress",
            data: series.map((day) => day.in_progress),
            backgroundColor: "#c8571b",
            borderRadius: 6,
            borderSkipped: false
          },
          {
            label: "Complete",
            data: series.map((day) => day.complete),
            backgroundColor: "#177245",
            borderRadius: 6,
            borderSkipped: false
          },
          {
            label: "Cancelled",
            data: series.map((day) => day.cancelled),
            backgroundColor: "#b42318",
            borderRadius: 6,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: {
          padding: {
            top: 8,
            right: 8,
            bottom: 0,
            left: 0
          }
        },
        interaction: {
          intersect: false,
          mode: "index"
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const day = series[items[0]?.dataIndex ?? 0];
                return day ? [`Total: ${day.total} ${day.total === 1 ? "job" : "jobs"}`] : [];
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: {
              display: false
            },
            border: {
              display: false
            },
            ticks: {
              color: "#64748b",
              font: {
                size: 12,
                weight: 800
              }
            }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grace: "12%",
            suggestedMax: 3,
            ticks: {
              precision: 0,
              color: "#64748b",
              font: {
                size: 11,
                weight: 700
              }
            },
            grid: {
              color: "rgba(100, 116, 139, 0.16)",
              drawTicks: false
            },
            border: {
              display: false
            }
          }
        }
      }
    });

    return () => chart.destroy();
  }, [series]);

  return (
    <div className="operations-chart">
      <div className="chart-frame workload-chart" aria-label="Weekly job workload">
        <div className="workload-chart-head">
          <div>
            <strong>This week</strong>
            <span>{weekRange}</span>
          </div>
          <div className="workload-total">
            <span>Total</span>
            <strong>{summary.totalJobs}</strong>
          </div>
        </div>
        <div className="workload-canvas-wrap">
          <canvas ref={canvasRef} aria-label="Weekly stacked bar chart by job status" role="img" />
        </div>
      </div>
      <div className="status-stack" aria-label="Job status breakdown">
        <div className="status-summary">
          <div>
            <span>Open</span>
            <strong>{summary.openJobs}</strong>
          </div>
          <div>
            <span>Done</span>
            <strong>{summary.completedJobs}</strong>
          </div>
          <div>
            <span>Rate</span>
            <strong>{summary.completionRate}%</strong>
          </div>
        </div>
        <div className="status-list">
          {statusRows.map((row) => (
            <div key={row.status} className={`status-meter status-meter-${row.status}`}>
              <span className="status-dot" />
              <span>{row.label}</span>
              <strong>{row.count}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
