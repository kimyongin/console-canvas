import { useLayoutEffect, useRef, useId, type ComponentProps } from 'react';
// Native top-layer dialogs/popovers also work inside other native modal dialogs.
// Keep the existing imperative surface API while React owns their stable contents.
export function DialogSurface(props: ComponentProps<'dialog'>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const heading = dialog.querySelector('h2,h3');
    if (heading && !dialog.hasAttribute('aria-labelledby') && !dialog.hasAttribute('aria-label')) {
      if (!heading.id) heading.id = titleId;
      dialog.setAttribute('aria-labelledby', heading.id);
    }
    let trigger: HTMLElement | null = null;
    const showModal = dialog.showModal;
    dialog.showModal = function () {
      if (!dialog.open)
        trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return showModal.call(dialog);
    };
    const close = () => {
      if (trigger?.isConnected && !trigger.closest('dialog:not([open])')) trigger.focus();
    };
    const composition = (event: KeyboardEvent) => {
      if ((event.isComposing || event.keyCode === 229) && event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    dialog.addEventListener('keydown', composition);
    dialog.addEventListener('close', close);
    return () => {
      dialog.showModal = showModal;
      dialog.removeEventListener('close', close);
      dialog.removeEventListener('keydown', composition);
    };
  }, []);
  return <dialog {...props} ref={ref} data-slot="dialog" />;
}
export function NativeSelect(props: ComponentProps<'select'>) {
  return <select data-slot="select" {...props} />;
}
