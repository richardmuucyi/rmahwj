"""gen_themes.py keeps the version plugin.json holds: a re-run never rolls a bump back.

Run: python -m unittest discover -s tests   (from the all-themes folder)
Every run writes into a temp folder; the mod's own files are only read.
"""
import json, os, shutil, subprocess, sys, tempfile, unittest

MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(MOD, 'gen_themes.py')


def generate(out):
    subprocess.run([sys.executable, '-B', GEN, out], check=True, capture_output=True)
    with open(os.path.join(out, '.claude-plugin', 'plugin.json'), encoding='utf-8') as f:
        return json.load(f)['version']


class VersionIsKept(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp(prefix='all-themes-test-')
        self.addCleanup(shutil.rmtree, self.out, ignore_errors=True)

    def test_a_bumped_version_in_the_output_folder_survives_a_rerun(self):
        os.makedirs(os.path.join(self.out, '.claude-plugin'))
        with open(os.path.join(self.out, '.claude-plugin', 'plugin.json'), 'w', encoding='utf-8') as f:
            json.dump({'name': 'all-themes', 'version': '9.8.7'}, f)
        self.assertEqual(generate(self.out), '9.8.7')

    def test_a_fresh_output_folder_takes_the_mods_own_version(self):
        with open(os.path.join(MOD, '.claude-plugin', 'plugin.json'), encoding='utf-8') as f:
            own = json.load(f)['version']
        self.assertEqual(generate(self.out), own)

    def test_the_committed_themes_are_what_the_generator_writes(self):
        generate(self.out)
        names = sorted(os.listdir(os.path.join(MOD, 'themes')))
        self.assertEqual(names, sorted(os.listdir(os.path.join(self.out, 'themes'))))
        for name in names:
            with open(os.path.join(MOD, 'themes', name), 'rb') as a, open(os.path.join(self.out, 'themes', name), 'rb') as b:
                self.assertEqual(a.read().replace(b'\r\n', b'\n'), b.read().replace(b'\r\n', b'\n'), name)


if __name__ == '__main__':
    unittest.main()
