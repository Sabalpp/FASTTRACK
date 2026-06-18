"use client";

import Chart from "chart.js/auto";
import { useEffect, useMemo, useRef } from "react";
import { formatDateTime } from "@/lib/date";
import { money } from "@/lib/money";
import type { Invoice, InvoiceStatus, Job, JobStatus } from "@/lib/types";

const statusLabels: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled"
};

const invoiceLabels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  cancelled: "Cancelled"
};

const jobColors: Record<JobStatus, string> = {
  scheduled: "#263846",
  in_progress: "#c8571b",
  complete: "#177245",
  cancelled: "#b42318"
};

const invoiceColors: Record<InvoiceStatus, string> = {
  draft: "#c8571b",
  sent: "#263846",
  paid: "#177245",
  cancelled: "#b42318"
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

function invoiceAmount(invoice: Invoice) {
  if (invoice.selectedTier === "good") return invoice.totalGood;
  if (invoice.selectedTier === "better") return invoice.totalBetter;
  if (invoice.selectedTier === "best") return invoice.totalBest;
  return invoice.totalBest || invoice.totalBetter || invoice.totalGood;
}

export function OperationsChart({
  jobs,
  invoices,
  canSeeMoney
}: {
  jobs: Job[];
  invoices: Invoice[];
  canSeeMoney: boolean;
}) {
  const workloadRef = useRef<HTMLCanvasElement | null>(null);
  const invoiceRef = useRef<HTMLCanvasElement | null>(null);

  const metrics = useMemo(() => {
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

    const invoiceCounts: Record<InvoiceStatus, number> = {
      draft: 0,
      sent: 0,
      paid: 0,
      cancelled: 0
    };
    const invoiceTotals: Record<InvoiceStatus, number> = {
      draft: 0,
      sent: 0,
      paid: 0,
      cancelled: 0
    };

    invoices.forEach((invoice) => {
      const amount = invoiceAmount(invoice);
      invoiceCounts[invoice.status] += 1;
      invoiceTotals[invoice.status] += amount;
    });

    const totalJobs = jobs.length;
    const openJobs = statusCounts.scheduled + statusCounts.in_progress;
    const completedJobs = statusCounts.complete;
    const completionRate = totalJobs === 0 ? 0 : Math.round((completedJobs / totalJobs) * 100);
    const activeInvoiceTotal = invoiceTotals.draft + invoiceTotals.sent;
    const nextJob = jobs
      .filter((job) => job.status !== "complete" && job.status !== "cancelled")
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

    return {
      days,
      statusRows: (Object.entries(statusCounts) as [JobStatus, number][]).map(([status, count]) => ({
        status,
        label: statusLabels[status],
        count
      })),
      invoiceRows: (Object.entries(invoiceCounts) as [InvoiceStatus, number][]).map(([status, count]) => ({
        status,
        label: invoiceLabels[status],
        count,
        amount: invoiceTotals[status]
      })),
      invoiceTotals,
      summary: {
        totalJobs,
        openJobs,
        completedJobs,
        completionRate,
        activeInvoiceTotal,
        paidInvoiceTotal: invoiceTotals.paid,
        nextJob
      }
    };
  }, [jobs, invoices]);

  const weekRange = `${metrics.days[0]?.date ?? ""} - ${metrics.days[metrics.days.length - 1]?.date ?? ""}`;

  useEffect(() => {
    const canvas = workloadRef.current;
    if (!canvas) return;

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: metrics.days.map((day) => day.day),
        datasets: (Object.keys(jobColors) as JobStatus[]).map((status) => ({
          label: statusLabels[status],
          data: metrics.days.map((day) => day[status]),
          backgroundColor: jobColors[status],
          borderRadius: 6,
          borderSkipped: false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        layout: {
          padding: { top: 8, right: 8, bottom: 0, left: 0 }
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
                const day = metrics.days[items[0]?.dataIndex ?? 0];
                return day ? [`Total: ${day.total} ${day.total === 1 ? "job" : "jobs"}`] : [];
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: "#64748b",
              font: { size: 12, weight: 800 }
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
  }, [metrics.days]);

  useEffect(() => {
    const canvas = invoiceRef.current;
    if (!canvas || !canSeeMoney) return;

    const values = metrics.invoiceRows.map((row) => row.amount);
    const hasValue = values.some((value) => value > 0);
    const chart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: metrics.invoiceRows.map((row) => row.label),
        datasets: [
          {
            data: hasValue ? values : metrics.invoiceRows.map((row) => row.count),
            backgroundColor: metrics.invoiceRows.map((row) => invoiceColors[row.status]),
            borderColor: "#ffffff",
            borderWidth: 2,
            hoverOffset: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "66%",
        animation: {
          duration: 240
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const row = metrics.invoiceRows[item.dataIndex];
                if (!row) return "";
                return hasValue ? `${row.label}: ${money(row.amount)}` : `${row.label}: ${row.count}`;
              }
            }
          }
        }
      }
    });

    return () => chart.destroy();
  }, [canSeeMoney, metrics.invoiceRows]);

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
            <strong>{metrics.summary.totalJobs}</strong>
          </div>
        </div>
        <div className="workload-canvas-wrap">
          <canvas ref={workloadRef} aria-label="Weekly stacked bar chart by job status" role="img" />
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
              <span>Done</span>
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

        {canSeeMoney ? (
          <div className="invoice-pipeline-card" aria-label="Invoice pipeline">
            <div className="invoice-pipeline-head">
              <div>
                <strong>Pipeline</strong>
                <span>Draft and sent value</span>
              </div>
              <strong>{money(metrics.summary.activeInvoiceTotal)}</strong>
            </div>
            <div className="invoice-pipeline-body">
              <div className="invoice-canvas-wrap">
                <canvas ref={invoiceRef} aria-label="Invoice status value chart" role="img" />
              </div>
              <div className="invoice-status-list">
                {metrics.invoiceRows.map((row) => (
                  <div key={row.status} className={`status-meter invoice-meter invoice-meter-${row.status}`}>
                    <span className="status-dot" />
                    <span>{row.label}</span>
                    <strong>{money(row.amount)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="next-work-card">
          <span>Next active job</span>
          {metrics.summary.nextJob ? (
            <>
              <strong>{formatDateTime(metrics.summary.nextJob.scheduledAt)}</strong>
              <p>{metrics.summary.nextJob.description}</p>
            </>
          ) : (
            <strong>No active jobs</strong>
          )}
        </div>
      </div>
    </div>
  );
}
