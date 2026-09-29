import string, collections, json, sys
W = set(w.strip().lower() for w in open("words_alpha.txt") if w.strip())
A = string.ascii_lowercase
def nbrs(w):
    out = set()
    for i in range(len(w) + 1):
        for c in A:
            out.add(w[:i] + c + w[i:])                      # insert
    for i in range(len(w)):
        out.add(w[:i] + w[i+1:])                            # delete
        for c in A:
            if c != w[i]: out.add(w[:i] + c + w[i+1:])      # substitute
    out.discard(w)
    return out & W
def component(start, cap=5000):
    seen = {start}; q = collections.deque([start])
    while q and len(seen) < cap:
        for n in nbrs(q.popleft()):
            if n not in seen: seen.add(n); q.append(n)
    return seen
starts = ["hat","mine","lung","layer","pattern","camping","avoid","traveller","origin","abysmal"]
res = {}
for s in starts:
    c = component(s)
    res[s] = {"in_dict": s in W, "component_size": len(c) if len(c) < 5000 else ">=5000",
              "component": sorted(c) if len(c) < 50 else None}
    print(s, res[s]["component_size"], res[s]["component"] if res[s]["component"] and len(c) < 15 else "")
json.dump(res, open("lisan_components.json", "w"), indent=1)
