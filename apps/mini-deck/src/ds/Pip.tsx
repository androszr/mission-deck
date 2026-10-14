export type PipPose = 'idle' | 'working' | 'sleeping' | 'error';

interface PipProps {
  pose: PipPose;
  title: string;
  hint?: string;
}

/** Pip is the loading, empty and error state of every screen. */
export function Pip({ pose, title, hint }: PipProps) {
  return (
    <div className="md-pip" role="status">
      <img src={`${import.meta.env.BASE_URL}mascot/pip-${pose}.svg`} alt="" width={96} height={96} />
      <p className="md-pip-title">{title}</p>
      {hint ? <p className="md-pip-hint">{hint}</p> : null}
    </div>
  );
}
