export default function StatCard({ label, value, sub }) {
  return <div className="stat-card"><span>{label}</span><b>{value}</b>{sub && <em>{sub}</em>}</div>
}
