import { useId, useRef } from 'react';
import { Button } from './button';
export interface MenuAction {
  label: string;
  scope?: string;
  kind?: string;
  className?: string;
  run: () => unknown;
}
export function ActionMenu({
  label,
  actions,
  disabled = false,
}: {
  label: string;
  actions: MenuAction[];
  disabled?: boolean;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  function open(last = false) {
    const host = menu.current!,
      button = trigger.current!;
    host.showPopover();
    const rect = button.getBoundingClientRect();
    host.style.left =
      Math.max(8, Math.min(innerWidth - host.offsetWidth - 8, rect.right - host.offsetWidth)) +
      'px';
    host.style.top =
      Math.max(8, Math.min(innerHeight - host.offsetHeight - 8, rect.bottom + 4)) + 'px';
    (last ? host.lastElementChild : host.firstElementChild)?.scrollIntoView({ block: 'nearest' });
    ((last ? host.lastElementChild : host.firstElementChild) as HTMLElement)?.focus();
  }
  return (
    <div className="action-menu">
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="more-actions"
        disabled={disabled}
        aria-label={label + ' · 기타 작업'}
        aria-haspopup="menu"
        aria-expanded={false}
        aria-controls={id}
        onClick={() =>
          menu.current!.matches(':popover-open') ? menu.current!.hidePopover() : open()
        }
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            open(e.key === 'ArrowUp');
          }
        }}
      >
        ⋯
      </Button>
      <div
        ref={menu}
        id={id}
        className="action-menu-popover"
        popover="auto"
        role="menu"
        aria-label={label + ' 작업'}
        onToggle={(event) =>
          trigger.current?.setAttribute(
            'aria-expanded',
            String(event.currentTarget.matches(':popover-open')),
          )
        }
        onKeyDown={(e) => {
          const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button')],
            index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            buttons[
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? buttons.length - 1
                  : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
            ]?.focus();
          } else if (e.key === 'Escape' || e.key === 'Tab') {
            menu.current!.hidePopover();
            trigger.current!.focus();
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
            }
          }
        }}
      >
        {actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            variant="ghost"
            role="menuitem"
            className={action.className}
            aria-label={label + ' · ' + action.label}
            {...(action.kind ? { ['data-' + action.scope + '-action']: action.kind } : {})}
            onClick={() => {
              menu.current!.hidePopover();
              trigger.current!.focus({ preventScroll: true });
              action.run();
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
