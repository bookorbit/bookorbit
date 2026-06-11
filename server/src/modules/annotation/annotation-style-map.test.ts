import {
  applyDeviceColor,
  applyDeviceStyle,
  drawerFromStyle,
  hexFromKoboColor,
  hexFromKoreaderColor,
  koboColorFromHex,
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
    it('maps KOReader named colors to BookOrbit equivalents', () => {
      expect(hexFromKoreaderColor('yellow')).toBe('#FACC15');
      expect(hexFromKoreaderColor('olive')).toBe('#84CC16');
      expect(hexFromKoreaderColor('cyan')).toBe('#22D3EE');
      expect(hexFromKoreaderColor('GRAY')).toBe('#9CA3AF');
    });

    it('maps exact KOReader hex values to BookOrbit equivalents', () => {
      expect(hexFromKoreaderColor('#ffff33')).toBe('#FACC15');
      expect(hexFromKoreaderColor('88ff77')).toBe('#84CC16');
    });

    it('passes through unknown hex values, normalizing case and prefix', () => {
      expect(hexFromKoreaderColor('#abc123')).toBe('#ABC123');
      expect(hexFromKoreaderColor('facc15')).toBe('#FACC15');
    });

    it('defaults to yellow for null or junk', () => {
      expect(hexFromKoreaderColor(null)).toBe('#FACC15');
      expect(hexFromKoreaderColor('not-a-color')).toBe('#FACC15');
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
      expect(koreaderColorFromHex('#84CC16')).toBe('olive');
      expect(koreaderColorFromHex('#22D3EE')).toBe('cyan');
      expect(koreaderColorFromHex('#C084FC')).toBe('purple');
      expect(koreaderColorFromHex('#9CA3AF')).toBe('gray');
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
      expect(applyDeviceColor('#FACC15', 'blue')).toBe('#38BDF8');
    });

    it('applies exact device hex colors as BookOrbit equivalents', () => {
      expect(applyDeviceColor('#FACC15', '#00AA66')).toBe('#4ADE80');
    });

    it('keeps the canonical color when the device sends none', () => {
      expect(applyDeviceColor('#FACC15', null)).toBe('#FACC15');
    });
  });

  describe('Kobo color mapping', () => {
    it('maps Kobo colors into BookOrbit equivalents', () => {
      expect(hexFromKoboColor('#F6F3B3')).toBe('#FACC15');
      expect(hexFromKoboColor('#E8AFCF')).toBe('#F472B6');
    });

    it('uses explicit Kobo fallbacks for BookOrbit colors', () => {
      expect(koboColorFromHex('#F87171')).toBe('#E8AFCF');
      expect(koboColorFromHex('#FB923C')).toBe('#F6F3B3');
      expect(koboColorFromHex('#84CC16')).toBe('#C6E09E');
      expect(koboColorFromHex('#22D3EE')).toBe('#B2E1E8');
      expect(koboColorFromHex('#C084FC')).toBe('#E8AFCF');
      expect(koboColorFromHex('#9CA3AF')).toBe('#F6F3B3');
    });

    it('uses explicit Kobo fallbacks for exact KOReader colors', () => {
      expect(koboColorFromHex('#FF3300')).toBe('#E8AFCF');
      expect(koboColorFromHex('#FF8800')).toBe('#F6F3B3');
      expect(koboColorFromHex('#FFFF33')).toBe('#F6F3B3');
      expect(koboColorFromHex('#00FFEE')).toBe('#B2E1E8');
      expect(koboColorFromHex('#EE00FF')).toBe('#E8AFCF');
      expect(koboColorFromHex('#808080')).toBe('#F6F3B3');
    });
  });
});
