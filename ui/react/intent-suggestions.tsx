import { renderReact } from './mount';
import { Button } from './components/button';
export function renderIntentSuggestions(
  host: Element,
  geometry: { label: string; text: string }[],
  responsive: { label: string; text: string }[],
  add: (text: string, responsive: boolean) => void,
) {
  renderReact(
    host,
    <div className="intent-suggestions">
      {!!geometry.length && (
        <>
          <strong>배치 의도 제안</strong>
          <div>
            {geometry.map((item) => (
              <Button
                key={item.text}
                size="content"
                variant="outline"
                onClick={() => add(item.text, false)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </>
      )}
      <strong>좁은 화면에서는</strong>
      <div>
        {responsive.map((item) => (
          <Button
            key={item.text}
            size="content"
            variant="outline"
            onClick={() => add(item.text, true)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <small>선택한 문장만 요청에 추가됩니다. 자유롭게 고쳐 쓰세요.</small>
    </div>,
  );
}
