/** A touch screen without a mouse (phones, most tablets). Kept tiny: the store imports it. */
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  (!!window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(hover: hover)').matches));
