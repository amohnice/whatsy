const LABEL = { cold: 'cold', warm: 'warm', hot: 'hot' };

export default function Badge({ status }) {
  const key = LABEL[status] ? status : 'cold';
  return <span className={`badge badge-${key}`}>{LABEL[key]}</span>;
}
