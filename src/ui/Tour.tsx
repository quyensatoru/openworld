// A short first-visit guide (five steps, skippable). It opens by itself once; the "?" in the top
// bar brings it back. The full list of keys and floors stays in Help (Cài đặt → Hướng dẫn).
import { useEffect, useState } from 'react';
import { setState, useStore } from '../store';

interface Step {
  icon: string;
  title: string;
  body: (touch: boolean) => string;
}

const STEPS: Step[] = [
  {
    icon: '👋',
    title: 'Chào mừng đến văn phòng',
    body: () => 'Đây là văn phòng ảo của cả team: đi lại, gặp đồng nghiệp, ngồi vào bàn để bắt đầu giờ làm. Năm bước ngắn là đủ để bắt đầu.',
  },
  {
    icon: '🕹️',
    title: 'Đi lại',
    body: (touch) =>
      touch
        ? 'Kéo cần gạt bên trái để đi, nút ✋ để ngồi hay mở đồ vật. Chạm ghế để ngồi, chạm sàn để đi tới đó; vuốt để xoay camera.'
        : 'W A S D hoặc phím mũi tên để đi (giữ Shift để chạy), E để tương tác. Click ghế để ngồi, kéo chuột để xoay camera.',
  },
  {
    icon: '🎙️',
    title: 'Nói chuyện',
    body: (touch) =>
      `Bật mic rồi đi lại gần đồng nghiệp là nói chuyện được, càng xa càng nhỏ. Muốn nhắn thì mở 💬 Chat${touch ? '' : ' (phím Enter)'}.`,
  },
  {
    icon: '🧠',
    title: 'Giao việc cho nhân viên AI',
    body: () =>
      'Trong Chat, chọn 🏢 Văn phòng của bạn rồi nói việc cần làm, có sẵn mẫu câu để bấm. Tổng quản chia việc cho các phòng và gửi 📋 Kết quả; bấm 👍 hoặc 👎 để chấm.',
  },
  {
    icon: '🏢',
    title: 'Khám phá các tầng',
    body: () =>
      'Bấm vào tên khu ở góc trên để đi nhanh: rạp phim, bar, phòng game, karaoke, ma sói, nội gián, trốn tìm, tiệc cưới. Cần xem lại thì bấm nút ? ở góc trên.',
  },
];

export function Tour() {
  const touch = useStore((s) => s.touch);
  const [i, setI] = useState(0);
  const close = () => setState({ tourOpen: false });
  const last = i === STEPS.length - 1;
  const next = () => (last ? close() : setI(i + 1));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((n) => Math.min(STEPS.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const s = STEPS[i];
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal glass tour" role="dialog" aria-modal="true" aria-label="Hướng dẫn nhanh" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={close} aria-label="Đóng">
          ✕
        </button>
        <div className="tour-icon">{s.icon}</div>
        <h2>{s.title}</h2>
        <p className="tour-body">{s.body(touch)}</p>
        <div className="tour-dots" aria-label={`Bước ${i + 1} / ${STEPS.length}`}>
          {STEPS.map((x, n) => (
            <button key={x.title} className={n === i ? 'on' : ''} onClick={() => setI(n)} aria-label={`Bước ${n + 1}`} />
          ))}
        </div>
        <div className="tour-actions">
          {last ? (
            <button className="btn" onClick={() => setState({ tourOpen: false, helpOpen: true })}>
              Xem đầy đủ phím tắt
            </button>
          ) : (
            <button className="btn" onClick={close}>
              Bỏ qua
            </button>
          )}
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              ← Trước
            </button>
          )}
          <button className="btn primary" autoFocus onClick={next}>
            {last ? 'Bắt đầu thôi!' : 'Tiếp →'}
          </button>
        </div>
      </div>
    </div>
  );
}
