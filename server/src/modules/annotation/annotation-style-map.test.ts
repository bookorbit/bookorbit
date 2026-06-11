import {
  applyDeviceColor,
  applyDeviceStyle,
  drawerFromStyle,
  hexFromKoreaderColor,
  koreaderColorFromHex,
  styleFromDrawer,
} from './annotation-style-map';

describe('annotation-style-map', () => {
  describe('styleFromDrawer / drawerFromStyle', () => {
    it('maps each drawer to its canonical style', () => {
      expect(styleFromDrawer('lighten')).toBe('highlight');
      expect(styleFromDrawer('underscore')).toBe('underline');
      expect(styleFromDrawer('strikeout')).toBe('strikethrough');
      expect(styleFromDrawer('invert')).toBe('invert');
    });

    it('falls back to highlight for unknown drawers', () => {
      expect(styleFromDrawer('wavy')).toBe('highlight');
      expect(styleFromDrawer(null)).toBe('highlight');
    });

    it('maps canonical styles to drawers with squiggly degrading to underscore', () => {
      expect(drawerFromStyle('highlight')).toBe('lighten');
      expect(drawerFromStyle('underline')).toBe('underscore');
      expect(drawerFromStyle('strikethrough')).toBe('strikeout');
      expect(drawerFromStyle('squiggly')).toBe('underscore');
      expect(drawerFromStyle('invert')).toBe('invert');
    });

    it('round-trips every drawer through canonical and back', () => {
      for (const drawer of ['lighten', 'underscore', 'strikeout', 'invert'] as const) {
        expect(drawerFromStyle(styleFromDrawer(drawer))).toBe(drawer);
      }
    });
  });

  describe('hexFromKoreaderColor', () => {
    it('maps KOReader named colors to their hex values', () => {
      expect(hexFromKoreaderColor('yellow')).toBe('#FFFF33');
      expect(hexFromKoreaderColor('olive')).toBe('#88FF77');
      expect(hexFromKoreaderColor('GRAY')).toBe('#808080');
    });

    it('passes through hex values, normalizing case and prefix', () => {
      expect(hexFromKoreaderColor('#facc15')).toBe('#FACC15');
      expect(hexFromKoreaderColor('facc15')).toBe('#FACC15');
    });

    it('defaults to yellow for null or junk', () => {
      expect(hexFromKoreaderColor(null)).toBe('#FFFF33');
      expect(hexFromKoreaderColor('not-a-color')).toBe('#FFFF33');
    });
  });

  describe('koreaderColorFromHex', () => {
    it('returns the exact name for known hex values', () => {
      expect(koreaderColorFromHex('#FFFF33')).toBe('yellow');
      expect(koreaderColorFromHex('#0066FF')).toBe('blue');
    });

    it('picks the nearest named color for arbitrary hex', () => {
      expect(koreaderColorFromHex('#FACC15')).toBe('yellow');
      expect(koreaderColorFromHex('#F472B6')).toBe('purple');
      expect(koreaderColorFromHex('#111111')).toBe('gray');
    });

    it('defaults to yellow for unparsable input', () => {
      expect(koreaderColorFromHex('nope')).toBe('yellow');
      expect(koreaderColorFromHex(null)).toBe('yellow');
    });
  });

  describe('applyDeviceStyle (projection rule)', () => {
    it('keeps canonical squiggly when the device echoes its projected underscore', () => {
      expect(applyDeviceStyle('squiggly', 'underscore')).toBe('squiggly');
    });

    it('applies a genuinely different drawer', () => {
      expect(applyDeviceStyle('squiggly', 'lighten')).toBe('highlight');
      expect(applyDeviceStyle('highlight', 'strikeout')).toBe('strikethrough');
    });

    it('keeps the canonical style when drawer is missing', () => {
      expect(applyDeviceStyle('underline', null)).toBe('underline');
    });
  });

  describe('applyDeviceColor (projection rule)', () => {
    it('keeps a custom web hex when the device echoes its projected named color', () => {
      expect(applyDeviceColor('#FACC15', 'yellow')).toBe('#FACC15');
    });

    it('applies a genuinely different named color', () => {
      expect(applyDeviceColor('#FACC15', 'blue')).toBe('#0066FF');
    });

    it('applies device hex colors directly', () => {
      expect(applyDeviceColor('#FACC15', '#00AA66')).toBe('#00AA66');
    });

    it('keeps the canonical color when the device sends none', () => {
      expect(applyDeviceColor('#FACC15', null)).toBe('#FACC15');
    });
  });
});
