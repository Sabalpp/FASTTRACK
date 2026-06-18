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

function buildWeekRows(firstDay: Date) {
  return Array.from({ length: 7 }, (_, index) => {
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
}

export function OperationsChart({ jobs }: { jobs: Job[] }) {
  const workloadRef = useRef<HTMLCanvasElement | null>(null);

  const metrics = useMemo(() => {
    const currentWeekStart = startOfWeek(new Date());
    const currentWeekKeys = new Set(buildWeekRows(currentWeekStart).map((day) => day.key));
    const hasCurrentWeekWork = jobs.some((job) => currentWeekKeys.has(dayKey(new Date(job.scheduledAt))));
    const firstScheduledJob = [...jobs].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
    const firstDay = hasCurrentWeekWork || !firstScheduledJob ? currentWeekStart : startOfWeek(new Date(firstScheduledJob.scheduledAt));
    const days = buildWeekRows(firstDay);
    const periodLabel = hasCurrentWeekWork || !firstScheduledJob ? "This week" : "Job window";

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
      days,
      statusRows: (Object.entries(statusCounts) as [JobStatus, number][]).map(([status, count]) => ({
        status,
        label: statusLabels[status],
        count
      })),
      summary: {
        totalJobs,
        openJobs,
        completedJobs,
        completionRate,
        periodLabel
      }
    };
  }, [jobs]);

  const weekRange = `${metrics.days[0]?.date ?? ""} - ${metrics.days[metrics.days.length - 1]?.date ?? ""}`;
  const maxDailyJobs = Math.max(0, ...metrics.days.map((day) => Math.max(day.scheduled + day.in_progress, day.complete)));
  const chartMax = Math.max(3, maxDailyJobs + 1);

  useEffect(() => {
    const canvas = workloadRef.current;
    if (!canvas) return;

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: metrics.days.map((day) => day.day),
        datasets: [
          {
            label: "Open",
            data: metrics.days.map((day) => day.scheduled + day.in_progress),
            backgroundColor: "#263846",
            borderRadius: 9,
            borderSkipped: false,
            barPercentage: 0.82,
            categoryPercentage: 0.54,
            maxBarThickness: 32
          },
          {
            label: "Complete",
            data: metrics.days.map((day) => day.complete),
            backgroundColor: "#177245",
            borderRadius: 9,
            borderSkipped: false,
            barPercentage: 0.82,
            categoryPercentage: 0.54,
            maxBarThickness: 32
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        layout: {
          padding: { top: 10, right: 12, bottom: 0, left: 0 }
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
            displayColors: true,
            backgroundColor: "#111827",
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              afterBody: (items) => {
                const day = metrics.days[items[0]?.dataIndex ?? 0];
                return day ? [`Total: ${day.total} ${day.total === 1 ? "job" : "jobs"}`] : [];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: "#64748b",
              font: { size: 12, weight: 800 }
            }
          },
          y: {
            beginAtZero: true,
            grace: "12%",
            max: chartMax,
            ticks: {
              precision: 0,
              color: "#64748b",
              font: { size: 11, weight: 700 }
            },
            grid: {
              color: "rgba(100, 116, 139, 0.16)",
              drawTicks: false
            },
            border: { display: false }
          }
        }
      }
    });

    return () => chart.destroy();
  }, [chartMax, metrics.days]);

  return (
    <div className="operations-chart operations-chart-refined">
      <div className="chart-frame workload-chart" aria-label="Weekly job workload">
        <div className="workload-chart-head">
          <div>
            <strong>{metrics.summary.periodLabel === "This week" ? "Schedule" : metrics.summary.periodLabel}</strong>
            <span>{weekRange}</span>
          </div>
          <div className="workload-total">
            <span>Total</span>
            <strong>{metrics.summary.totalJobs}</strong>
          </div>
        </div>
        <div className="workload-canvas-wrap">
          <canvas ref={workloadRef} aria-label="Weekly workload bar chart" role="img" />
        </div>
        <div className="workload-legend" aria-hidden="true">
          <span><i className="legend-dot legend-dot-open" />Open</span>
          <span><i className="legend-dot legend-dot-complete" />Complete</span>
        </div>
      </div>

      <div className="operations-side-panel">
        <div className="status-stack" aria-label="Job status breakdown">
          <div className="status-summary">
            <div>
              <span>Open</span>
              <strong>{metrics.summary.openJobs}</strong>
            </div>
            <div>
              <span>Complete</span>
              <strong>{metrics.summary.completedJobs}</strong>
            </div>
            <div>
              <span>Rate</span>
              <strong>{metrics.summary.completionRate}%</strong>
            </div>
          </div>
          <div className="status-list">
            {metrics.statusRows.map((row) => (
              <div key={row.status} className={`status-meter status-meter-${row.status}`}>
                <span className="status-dot" />
                <span>{row.label}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
