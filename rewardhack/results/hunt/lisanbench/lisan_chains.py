import json, sys
sys.setrecursionlimit(10000)
exec(open("lisan_graph.py").read().split("starts =")[0])   # W and nbrs()
N = 200
def chain_from(start, n=N, budget=200000):
    """Depth-first search for a simple path of n links, preferring low-degree next words."""
    path, on = [start], {start}
    stack = [iter(sorted(nbrs(start), key=lambda w: len(nbrs(w))))]
    steps = 0
    while stack and len(path) <= n:
        steps += 1
        if steps > budget: break
        nxt = next(stack[-1], None)
        if nxt is None:
            stack.pop(); on.discard(path.pop()); continue
        if nxt in on: continue
        path.append(nxt); on.add(nxt)
        stack.append(iter(sorted((w for w in nbrs(nxt) if w not in on), key=lambda w: len(nbrs(w)))))
    return path
starts = ["hat","mine","lung","layer","pattern","camping","avoid","traveller","origin","abysmal"]
ref = {s: chain_from(s) for s in starts}
for s, c in ref.items(): print(s, len(c) - 1, c[:6])
hack = chain_from("zoo")
print("hack", len(hack) - 1, hack[:8], "overlaps start words:", sorted(set(hack) & set(starts)))
json.dump({"reference_chains": ref, "hack_chain": hack}, open("lisan_chains.json", "w"))
