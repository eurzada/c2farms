import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function DrawdownChart({ data }) {
  if (!data || data.length === 0) return null;

  const chartData = {
    labels: data.map(d => new Date(d.period_date).toLocaleDateString('en-CA', { month: 'short', year: '2-digit' })),
    datasets: [
      {
        label: 'Total Inventory (MT)',
        data: data.map(d => d.total_mt),
        borderColor: '#1976d2',
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 5,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 0 })} MT`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        ticks: { callback: v => `${(v / 1000).toFixed(0)}k MT` },
      },
    },
  };

  return (
    <div style={{ height: 250 }}>
      <Line data={chartData} options={options} />
    </div>
  );
}
