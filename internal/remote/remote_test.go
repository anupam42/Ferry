package remote

import "testing"

func TestParse(t *testing.T) {
	cases := map[string]Spec{
		"me@host:repo":               {Host: "me@host", Path: "~/repo"},
		"me@host:/srv/site":          {Host: "me@host", Path: "/srv/site"},
		"ssh://me@host:2222/srv/www": {Host: "me@host", Port: "2222", Path: "/srv/www"},
		"ssh://host/~/notes":         {Host: "host", Path: "~/notes"},
	}
	for in, want := range cases {
		got, err := Parse(in)
		if err != nil || got != want {
			t.Errorf("Parse(%q) = %+v, %v; want %+v", in, got, err, want)
		}
		again, err := Parse(got.String())
		if err != nil || again != got {
			t.Errorf("round trip of %q: %+v, %v", got.String(), again, err)
		}
	}
	for _, bad := range []string{"C:\\work", "/tmp/x", "host:path", "ssh://host"} {
		if IsSpec(bad) {
			if _, err := Parse(bad); err == nil {
				t.Errorf("Parse(%q) should fail", bad)
			}
		}
	}
}

func TestQuotePath(t *testing.T) {
	if got := QuotePath("~/my dir"); got != `"$HOME"/'my dir'` {
		t.Error(got)
	}
	if got := Quote("it's"); got != `'it'\''s'` {
		t.Error(got)
	}
}
