"""Builds the all-themes Claude Code plugin from public colour palettes.
Every theme is generated here from a palette table; nothing is copied.
Writes themes/, .claude-plugin/plugin.json and README.md next to this file
(or into the folder given as the first argument)."""
import json, os, shutil, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
def current_version():
    """plugin.json holds the version: the one in OUT, else the one beside this file. Bump it there, never here."""
    for folder in (OUT, os.path.dirname(os.path.abspath(__file__))):
        try:
            with open(f'{folder}/.claude-plugin/plugin.json', encoding='utf-8') as f: return json.load(f)['version']
        except (OSError, KeyError, ValueError): pass
    raise SystemExit('gen_themes: no .claude-plugin/plugin.json with a version to keep')
VERSION = current_version()

def hx(c): c = c.lstrip('#'); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))
def rgb(t): return f"rgb({t[0]},{t[1]},{t[2]})"
def mix(a, b, w):  # w = share of b
    a, b = hx(a), hx(b); return rgb(tuple(round(a[i]*(1-w) + b[i]*w) for i in range(3)))
def c(x): return rgb(hx(x))

# Semantic palette per theme:
# bg, bg1 (surface), bg2 (overlay/selection), fg, dim (comments), accent (Claude's
# orange role), blue, cyan, green, red, yellow, orange, purple, pink, indigo, light?
P = {}
def add(family, key, name, light, **k): P.setdefault(family, []).append((key, name, light, k))

# Base16 (base00..base0F)
add('base16','cupcake','Base16 Cupcake',True, bg='fbf1f2',bg1='f2f1f4',bg2='d8d5dd',fg='585062',dim='a59daf',accent='ebb790',blue='7297b9',cyan='69a9a7',green='a3b367',red='d57e85',yellow='dcb16c',orange='ebb790',purple='bb99b4',pink='bb99b4',indigo='7297b9',teal='69a9a7')
add('base16','eighties','Base16 Eighties',False, bg='2d2d2d',bg1='393939',bg2='515151',fg='d3d0c8',dim='747369',accent='f99157',blue='6699cc',cyan='66cccc',green='99cc99',red='f2777a',yellow='ffcc66',orange='f99157',purple='cc99cc',pink='cc99cc',indigo='6699cc',teal='66cccc')
add('base16','ocean','Base16 Ocean',False, bg='2b303b',bg1='343d46',bg2='4f5b66',fg='c0c5ce',dim='65737e',accent='d08770',blue='8fa1b3',cyan='96b5b4',green='a3be8c',red='bf616a',yellow='ebcb8b',orange='d08770',purple='b48ead',pink='b48ead',indigo='8fa1b3',teal='96b5b4')
# Catppuccin
add('catppuccin','latte','Catppuccin Latte',True, bg='eff1f5',bg1='e6e9ef',bg2='ccd0da',fg='4c4f69',dim='8c8fa1',accent='fe640b',blue='1e66f5',cyan='04a5e5',green='40a02b',red='d20f39',yellow='df8e1d',orange='fe640b',purple='8839ef',pink='ea76cb',indigo='7287fd',teal='179299')
add('catppuccin','frappe','Catppuccin Frappé',False, bg='303446',bg1='292c3c',bg2='414559',fg='c6d0f5',dim='838ba7',accent='ef9f76',blue='8caaee',cyan='99d1db',green='a6d189',red='e78284',yellow='e5c890',orange='ef9f76',purple='ca9ee6',pink='f4b8e4',indigo='babbf1',teal='81c8be')
add('catppuccin','macchiato','Catppuccin Macchiato',False, bg='24273a',bg1='1e2030',bg2='363a4f',fg='cad3f5',dim='8087a2',accent='f5a97f',blue='8aadf4',cyan='91d7e3',green='a6da95',red='ed8796',yellow='eed49f',orange='f5a97f',purple='c6a0f6',pink='f5bde6',indigo='b7bdf8',teal='8bd5ca')
add('catppuccin','mocha','Catppuccin Mocha',False, bg='1e1e2e',bg1='181825',bg2='313244',fg='cdd6f4',dim='7f849c',accent='fab387',blue='89b4fa',cyan='89dceb',green='a6e3a1',red='f38ba8',yellow='f9e2af',orange='fab387',purple='cba6f7',pink='f5c2e7',indigo='b4befe',teal='94e2d5')
# Dracula
add('dracula','dracula','Dracula',False, bg='282a36',bg1='21222c',bg2='44475a',fg='f8f8f2',dim='6272a4',accent='ffb86c',blue='8be9fd',cyan='8be9fd',green='50fa7b',red='ff5555',yellow='f1fa8c',orange='ffb86c',purple='bd93f9',pink='ff79c6',indigo='bd93f9',teal='8be9fd')
# Everforest (medium contrast)
add('everforest','dark','Everforest Dark',False, bg='2d353b',bg1='343f44',bg2='475258',fg='d3c6aa',dim='859289',accent='e69875',blue='7fbbb3',cyan='83c092',green='a7c080',red='e67e80',yellow='dbbc7f',orange='e69875',purple='d699b6',pink='d699b6',indigo='7fbbb3',teal='83c092')
add('everforest','light','Everforest Light',True, bg='fdf6e3',bg1='f4f0d9',bg2='e6e2cc',fg='5c6a72',dim='939f91',accent='f57d26',blue='3a94c5',cyan='35a77c',green='8da101',red='f85552',yellow='dfa000',orange='f57d26',purple='df69ba',pink='df69ba',indigo='3a94c5',teal='35a77c')
# GitHub (Primer)
add('github','dark','GitHub Dark Default',False, bg='0d1117',bg1='010409',bg2='161b22',fg='e6edf3',dim='8b949e',accent='f0883e',blue='58a6ff',cyan='39c5cf',green='3fb950',red='f85149',yellow='d29922',orange='f0883e',purple='bc8cff',pink='f778ba',indigo='79c0ff',teal='56d4dd')
add('github','dark-dimmed','GitHub Dark Dimmed',False, bg='22272e',bg1='1c2128',bg2='2d333b',fg='adbac7',dim='768390',accent='e0823d',blue='539bf5',cyan='39c5cf',green='57ab5a',red='e5534b',yellow='c69026',orange='e0823d',purple='b083f0',pink='e275ad',indigo='6cb6ff',teal='56d4dd')
add('github','light','GitHub Light Default',True, bg='ffffff',bg1='f6f8fa',bg2='eaeef2',fg='1f2328',dim='656d76',accent='bc4c00',blue='0969da',cyan='1b7c83',green='1a7f37',red='cf222e',yellow='9a6700',orange='bc4c00',purple='8250df',pink='bf3989',indigo='218bff',teal='3192aa')
# Gruvbox
add('gruvbox','dark','Gruvbox Dark',False, bg='282828',bg1='3c3836',bg2='504945',fg='ebdbb2',dim='928374',accent='fe8019',blue='83a598',cyan='8ec07c',green='b8bb26',red='fb4934',yellow='fabd2f',orange='fe8019',purple='d3869b',pink='d3869b',indigo='83a598',teal='8ec07c')
add('gruvbox','light','Gruvbox Light',True, bg='fbf1c7',bg1='ebdbb2',bg2='d5c4a1',fg='3c3836',dim='928374',accent='af3a03',blue='076678',cyan='427b58',green='79740e',red='9d0006',yellow='b57614',orange='af3a03',purple='8f3f71',pink='8f3f71',indigo='076678',teal='427b58')
# Monokai
add('monokai','classic','Classic Monokai',False, bg='272822',bg1='1e1f1c',bg2='3e3d32',fg='f8f8f2',dim='75715e',accent='fd971f',blue='66d9ef',cyan='66d9ef',green='a6e22e',red='f92672',yellow='e6db74',orange='fd971f',purple='ae81ff',pink='f92672',indigo='ae81ff',teal='66d9ef')
add('monokai-pro','pro','Monokai Pro',False, bg='2d2a2e',bg1='221f22',bg2='403e41',fg='fcfcfa',dim='727072',accent='fc9867',blue='78dce8',cyan='78dce8',green='a9dc76',red='ff6188',yellow='ffd866',orange='fc9867',purple='ab9df2',pink='ff6188',indigo='ab9df2',teal='78dce8')
# Nord
add('nord','nord','Nord',False, bg='2e3440',bg1='3b4252',bg2='434c5e',fg='d8dee9',dim='616e88',accent='d08770',blue='81a1c1',cyan='88c0d0',green='a3be8c',red='bf616a',yellow='ebcb8b',orange='d08770',purple='b48ead',pink='b48ead',indigo='5e81ac',teal='8fbcbb')
# One Dark / OneHalf
add('one-dark','one-dark','One Dark',False, bg='282c34',bg1='21252b',bg2='3e4451',fg='abb2bf',dim='5c6370',accent='d19a66',blue='61afef',cyan='56b6c2',green='98c379',red='e06c75',yellow='e5c07b',orange='d19a66',purple='c678dd',pink='c678dd',indigo='61afef',teal='56b6c2')
add('one-dark','onehalf-dark','OneHalf Dark',False, bg='282c34',bg1='21252b',bg2='3e4451',fg='dcdfe4',dim='5c6370',accent='e5c07b',blue='61afef',cyan='56b6c2',green='98c379',red='e06c75',yellow='e5c07b',orange='e5c07b',purple='c678dd',pink='c678dd',indigo='61afef',teal='56b6c2')
add('one-dark','onehalf-light','OneHalf Light',True, bg='fafafa',bg1='f0f0f0',bg2='e5e5e6',fg='383a42',dim='a0a1a7',accent='c18401',blue='0184bc',cyan='0997b3',green='50a14f',red='e45649',yellow='c18401',orange='c18401',purple='a626a4',pink='a626a4',indigo='0184bc',teal='0997b3')
# Rosé Pine
add('rose-pine','main','Rosé Pine',False, bg='191724',bg1='1f1d2e',bg2='26233a',fg='e0def4',dim='6e6a86',accent='f6c177',blue='9ccfd8',cyan='9ccfd8',green='31748f',red='eb6f92',yellow='f6c177',orange='ebbcba',purple='c4a7e7',pink='ebbcba',indigo='c4a7e7',teal='9ccfd8')
add('rose-pine','moon','Rosé Pine Moon',False, bg='232136',bg1='2a273f',bg2='393552',fg='e0def4',dim='6e6a86',accent='f6c177',blue='9ccfd8',cyan='9ccfd8',green='3e8fb0',red='eb6f92',yellow='f6c177',orange='ea9a97',purple='c4a7e7',pink='ea9a97',indigo='c4a7e7',teal='9ccfd8')
add('rose-pine','dawn','Rosé Pine Dawn',True, bg='faf4ed',bg1='fffaf3',bg2='f2e9e1',fg='575279',dim='9893a5',accent='ea9d34',blue='56949f',cyan='56949f',green='286983',red='b4637a',yellow='ea9d34',orange='d7827e',purple='907aa9',pink='d7827e',indigo='907aa9',teal='56949f')
# Solarized
add('solarized','dark','Solarized Dark',False, bg='002b36',bg1='073642',bg2='0a4a5a',fg='839496',dim='586e75',accent='cb4b16',blue='268bd2',cyan='2aa198',green='859900',red='dc322f',yellow='b58900',orange='cb4b16',purple='6c71c4',pink='d33682',indigo='6c71c4',teal='2aa198')
add('solarized','light','Solarized Light',True, bg='fdf6e3',bg1='eee8d5',bg2='e4dcc4',fg='657b83',dim='93a1a1',accent='cb4b16',blue='268bd2',cyan='2aa198',green='859900',red='dc322f',yellow='b58900',orange='cb4b16',purple='6c71c4',pink='d33682',indigo='6c71c4',teal='2aa198')
# Tokyo Night
add('tokyo-night','night','Tokyo Night',False, bg='1a1b26',bg1='16161e',bg2='292e42',fg='c0caf5',dim='565f89',accent='ff9e64',blue='7aa2f7',cyan='7dcfff',green='9ece6a',red='f7768e',yellow='e0af68',orange='ff9e64',purple='bb9af7',pink='bb9af7',indigo='7aa2f7',teal='73daca')

FAMILY_NAME = {'base16':'Base16','catppuccin':'Catppuccin','dracula':'Dracula','everforest':'Everforest','github':'GitHub','gruvbox':'Gruvbox','monokai':'Monokai','monokai-pro':'Monokai Pro','nord':'Nord','one-dark':'One Dark','rose-pine':'Rosé Pine','solarized':'Solarized','tokyo-night':'Tokyo Night'}

def overrides(p, light):
    bg, fg = p['bg'], p['fg']
    toward = 'ffffff' if not light else '000000'
    sh = lambda x: mix(x, toward, 0.25)              # shimmer: a step brighter (darker on light)
    tint = lambda x, w: mix(bg, x, w)                # a background tint of colour x
    o = {
        'claude': c(p['accent']), 'claudeShimmer': sh(p['accent']),
        'claudeBlue_FOR_SYSTEM_SPINNER': c(p['blue']), 'claudeBlueShimmer_FOR_SYSTEM_SPINNER': sh(p['blue']),
        'text': c(fg), 'inverseText': c(bg),
        'inactive': c(p['dim']), 'inactiveShimmer': mix(p['dim'], fg, 0.4), 'subtle': mix(p['dim'], bg, 0.35),
        'success': c(p['green']), 'error': c(p['red']), 'warning': c(p['yellow']), 'warningShimmer': sh(p['yellow']),
        'merged': c(p['purple']), 'remember': c(p['blue']),
        'promptBorder': c(p['dim']), 'promptBorderShimmer': mix(p['dim'], fg, 0.4), 'bashBorder': c(p['pink']),
        'permission': c(p['indigo']), 'permissionShimmer': sh(p['indigo']),
        'planMode': c(p['teal']), 'autoAccept': c(p['purple']), 'autoAcceptShimmer': sh(p['purple']),
        'fastMode': c(p['orange']), 'fastModeShimmer': sh(p['orange']), 'effortUltra': c(p['pink']),
        'skill': c(p['cyan']), 'ide': c(p['blue']),
        'diffAdded': tint(p['green'], 0.22), 'diffAddedDimmed': tint(p['green'], 0.12), 'diffAddedWord': tint(p['green'], 0.45),
        'diffRemoved': tint(p['red'], 0.22), 'diffRemovedDimmed': tint(p['red'], 0.12), 'diffRemovedWord': tint(p['red'], 0.45),
        'background': c(bg), 'userMessageBackground': c(p['bg1']) if not light else c(p['bg2']),
        'userMessageBackgroundHover': c(p['bg2']) if not light else mix(p['bg2'], fg, 0.08),
        'composerSidebarBackground': c(p['bg1']), 'selectionBg': c(p['bg2']),
        'bashMessageBackgroundColor': tint(p['pink'], 0.12), 'memoryBackgroundColor': tint(p['blue'], 0.12),
        'suggestion': c(p['blue']), 'rate_limit_fill': c(p['blue']), 'rate_limit_empty': c(p['bg2']),
        'briefLabelClaude': c(p['accent']), 'briefLabelYou': c(p['blue']),
        'chromeYellow': c(p['yellow']), 'professionalBlue': c(p['blue']),
        'clawd_body': c(p['accent']), 'clawd_background': c(bg),
    }
    for col, key in [('red','red'),('blue','blue'),('green','green'),('yellow','yellow'),('purple','purple'),('orange','orange'),('pink','pink'),('cyan','cyan')]:
        o[f'{col}_FOR_SUBAGENTS_ONLY'] = c(p[key])
    for col, key in [('red','red'),('orange','orange'),('yellow','yellow'),('green','green'),('blue','blue'),('indigo','indigo'),('violet','purple')]:
        o[f'rainbow_{col}'] = c(p[key]); o[f'rainbow_{col}_shimmer'] = sh(p[key])
    return o

shutil.rmtree(f'{OUT}/themes', ignore_errors=True)
os.makedirs(f'{OUT}/.claude-plugin', exist_ok=True); os.makedirs(f'{OUT}/themes', exist_ok=True)
for family, items in P.items():
    for key, name, light, pal in items:
        ov = overrides(pal, light)
        stem = family if key in (family, 'pro', 'night', 'main', 'classic') else f'{family}-{key}'
        for ansi in (False, True):
            base = ('light' if light else 'dark') + ('-ansi' if ansi else '')
            t = {'name': name + (' (ANSI)' if ansi else ''), 'base': base, 'overrides': ov}
            with open(f"{OUT}/themes/{stem}{'-ansi' if ansi else ''}.json", 'w', encoding='utf-8', newline=chr(10)) as f:
                json.dump(t, f, indent=2, ensure_ascii=False); f.write(chr(10))
total = sum(len(v) for v in P.values()) * 2
desc = f"{total} Claude Code UI themes from {len(P)} public colour palettes, each with an ANSI variant."
json.dump({'name': 'all-themes', 'version': VERSION, 'description': desc, 'author': {'name': 'Richard'}, 'license': 'MIT'},
          open(f'{OUT}/.claude-plugin/plugin.json', 'w', encoding='utf-8', newline=chr(10)), indent=2, ensure_ascii=False)
print(total, 'themes from', len(P), 'palettes')

CREDITS = {'base16':'Base16 schemes by Chris Kempson and contributors (MIT)','catppuccin':'Catppuccin (MIT)','dracula':'Dracula Theme (MIT)','everforest':'Everforest by sainnhe (MIT)','github':'GitHub Primer colours (MIT)','gruvbox':'Gruvbox by morhetz (MIT/X11)',
           'monokai':'Monokai by Wimer Hazenberg','monokai-pro':'Monokai Pro palette by Wimer Hazenberg (monokai.pro)','nord':'Nord by Arctic Ice Studio (MIT)',
           'one-dark':'One Dark (Atom, MIT) and OneHalf by sonph (MIT)','rose-pine':'Rosé Pine (MIT)','solarized':'Solarized by Ethan Schoonover (MIT)','tokyo-night':'Tokyo Night by enkia (MIT)'}
rows = chr(10).join(f"| {FAMILY_NAME[f]} | {', '.join(n for _, n, _, _ in P[f])} | {CREDITS[f]} |" for f in P)
open(f'{OUT}/README.md', 'w', encoding='utf-8', newline=chr(10)).write(f"""# all-themes

{total} Claude Code UI themes in one plugin. Each theme is generated by `gen_themes.py`
from a published colour palette (hex values only); every slot mapping is our own.
Each has a regular variant (fixed colours, base `dark`/`light`) and an **ANSI** variant
(base `dark-ansi`/`light-ansi`: code blocks use your terminal's ANSI colours).

## Install

```
/plugin marketplace add richardmuucyi/rmahwj
/plugin install all-themes@rmahwj
/reload-plugins
/theme
```

## Palettes

| Palette | Themes | Credit |
|---|---|---|
{rows}

## Slot mapping

Claude's orange → the palette's orange/peach · text → foreground · dim/inactive → comment colour ·
success/error/warning → green/red/yellow · your prompt row (`userMessageBackground`) → the palette's surface colour ·
diffs → green/red tints over the background · subagent and rainbow colours → the palette's own hues.
Edit a palette in `gen_themes.py` and re-run it to regenerate every file.

## Windows Terminal

`terminal/` holds matching Windows Terminal colour schemes; see its README.
""")
