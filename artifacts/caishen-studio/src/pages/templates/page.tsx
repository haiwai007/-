import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search, Layers3, Upload } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import { usePublicCatalog } from "@/lib/catalog-service/provider";
import {
  paginationWindow,
  TEMPLATE_PAGE_SIZE,
  templateMatches,
} from "@/lib/template/catalog";
import TemplateCard from "@/components/templates/template-card.tsx";
import { useStartTemplate } from "@/hooks/use-start-template.ts";
import { useTemplateFavorites } from "@/hooks/use-template-favorites.ts";
import { useWorks } from "@/hooks/use-works.ts";
import { cn } from "@/lib/utils.ts";
import CustomTemplateGrid from "./_components/custom-template-grid.tsx";

type Sort = "category" | "popular" | "latest" | "name";
const SORTS: Sort[] = ["category", "popular", "latest", "name"];
const PAGE_SIZES = [24, 48, 96];

export default function TemplatesPage() {
  const { templates: BUILTIN_TEMPLATES, categories: CATEGORIES } =
    usePublicCatalog();
  const CATEGORY_COUNTS = Object.fromEntries(
    CATEGORIES.map((c) => [
      c.id,
      BUILTIN_TEMPLATES.filter((t) => t.category === c.id).length,
    ]),
  );
  const categoryOrder = useMemo(
    () => new Map(CATEGORIES.map((c, i) => [c.id, i])),
    [CATEGORIES],
  );
  const [params, setParams] = useSearchParams();
  const requestedCategory = params.get("category") ?? "all";
  const category =
    requestedCategory === "custom" ||
    CATEGORIES.some((c) => c.id === requestedCategory)
      ? requestedCategory
      : "all";
  const [q, setQ] = useState("");
  const requestedSort = (params.get("sort") ?? "") as Sort;
  const sort: Sort = SORTS.includes(requestedSort) ? requestedSort : "popular";
  const setSort = (next: Sort) => {
    const nextParams = new URLSearchParams(params);
    if (next === "popular") nextParams.delete("sort");
    else nextParams.set("sort", next);
    nextParams.delete("page");
    setParams(nextParams);
  };
  const page = Math.max(1, Number(params.get("page")) || 1);
  const requestedSize = Number(params.get("size"));
  const pageSize = PAGE_SIZES.includes(requestedSize)
    ? requestedSize
    : TEMPLATE_PAGE_SIZE;
  const [onlyFav, setOnlyFav] = useState(false);
  const { favs, toggle } = useTemplateFavorites();
  const { start, busy } = useStartTemplate();
  const { state, refresh } = useWorks();
  const navigate = useNavigate();
  const chipRow = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    return BUILTIN_TEMPLATES.filter(
      (t) => category === "all" || t.category === category,
    )
      .filter((t) => !onlyFav || favs.includes(t.id))
      .filter((t) => templateMatches(t, q))
      .sort((a, b) => {
        if (sort === "popular") return b.popularity - a.popularity;
        if (sort === "latest") return b.addedAt.localeCompare(a.addedAt);
        if (sort === "name") return a.name.localeCompare(b.name, "zh");
        return (
          (categoryOrder.get(a.category) ?? 99) -
            (categoryOrder.get(b.category) ?? 99) ||
          a.name.localeCompare(b.name, "zh")
        );
      });
  }, [category, q, sort, onlyFav, favs, BUILTIN_TEMPLATES, categoryOrder]);

  const customTemplates =
    state.status === "ready"
      ? state.works
          .filter((w) => w.kind === "template")
          .filter((w) => !onlyFav || w.favorite)
          .filter(
            (w) =>
              !q.trim() ||
              w.name.toLowerCase().includes(q.trim().toLowerCase()),
          )
      : [];

  const useCustom = async (id: string) => {
    const w =
      state.status === "ready"
        ? state.works.find((x) => x.id === id)
        : undefined;
    if (!w) return;
    navigate(`/draw?template=${encodeURIComponent(`w:${w.id}`)}`);
  };

  const tabs = [
    { id: "all", label: "全部" },
    ...CATEGORIES,
    { id: "custom", label: "自定义模板" },
  ];
  /** 全部模板按分类聚合展示,适合模板数量较多的分类库。 */
  const grouped =
    sort === "category" && category === "all" && !q.trim() && !onlyFav;
  const groups = useMemo(() => {
    if (!grouped) return [];
    const map = new Map<string, (typeof list)[number][]>();
    for (const t of list) {
      const bucket = map.get(t.category);
      if (bucket) bucket.push(t);
      else map.set(t.category, [t]);
    }
    return [...map.entries()].map(([id, items]) => ({
      id,
      label:
        items[0].categoryName ??
        CATEGORIES.find((c) => c.id === id)?.label ??
        id,
      items,
    }));
  }, [grouped, list, CATEGORIES]);
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const currentPage = Math.min(Math.floor(page), pageCount);
  const visibleList = grouped
    ? list
    : list.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const changePage = (next: number) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", String(next));
    setParams(nextParams);
  };
  const resetPage = () => {
    if (params.has("page")) {
      const next = new URLSearchParams(params);
      next.delete("page");
      setParams(next, { replace: true });
    }
  };
  const changeSize = (next: number) => {
    const nextParams = new URLSearchParams(params);
    if (next === TEMPLATE_PAGE_SIZE) nextParams.delete("size");
    else nextParams.set("size", String(next));
    nextParams.delete("page");
    setParams(nextParams);
  };
  useEffect(() => {
    chipRow.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [category]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold">
            {category === "custom" ? "我的模板" : "模板库"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            现有 {BUILTIN_TEMPLATES.length} 套模板、{CATEGORIES.length}{" "}
            个分类，可编辑图层，也可按参数批量生成。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/submit">提交模板</Link>
          </Button>
          <Button asChild>
            <Link to="/custom">
              <Upload className="size-4" /> 从图片生成模板
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 sm:hidden">
        <label className="block space-y-1 text-sm font-medium">
          模板分类
          <select
            aria-label="模板分类"
            value={category}
            onChange={(e) =>
              setParams(
                e.target.value === "all" ? {} : { category: e.target.value },
              )
            }
            className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
          >
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.id === "all"
                  ? `（${BUILTIN_TEMPLATES.length}）`
                  : t.id !== "custom"
                    ? `（${CATEGORY_COUNTS[t.id]}）`
                    : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        ref={chipRow}
        className="mt-6 hidden gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] sm:flex"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            data-active={category === t.id}
            onClick={() => setParams(t.id === "all" ? {} : { category: t.id })}
            className={cn(
              "shrink-0 cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors",
              category === t.id
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:border-primary",
            )}
          >
            {t.label}{" "}
            <span className="ml-1 opacity-65">
              {t.id === "all"
                ? BUILTIN_TEMPLATES.length
                : t.id === "custom"
                  ? state.status === "ready"
                    ? state.works.filter((w) => w.kind === "template").length
                    : ""
                  : CATEGORY_COUNTS[t.id]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索模板"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
            placeholder="搜索模板，例如：海报、价格、旅行"
            className="pl-9"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(v) => {
            setSort(v as Sort);
          }}
        >
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">最热门</SelectItem>
            <SelectItem value="category">按分类</SelectItem>
            <SelectItem value="latest">最新</SelectItem>
            <SelectItem value="name">按名称</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            changeSize(Number(v));
          }}
        >
          <SelectTrigger aria-label="每页数量" className="sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                每页 {n} 套
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={onlyFav ? "default" : "secondary"}
          onClick={() => {
            setOnlyFav((v) => !v);
            resetPage();
          }}
        >
          只看收藏
        </Button>
      </div>

      {category !== "custom" && (
        <p
          role="status"
          aria-label="模板筛选结果"
          className="mt-4 text-sm text-muted-foreground"
        >
          找到 {list.length} 套模板 · 每页 {pageSize} 套
          {!grouped && pageCount > 1 && ` · 第 ${currentPage} / ${pageCount} 页`}
          {grouped && ` · 已按分类聚合显示`}
        </p>
      )}

      {category === "custom" ? (
        <CustomTemplateGrid
          loading={state.status === "loading"}
          templates={customTemplates}
          onUse={useCustom}
          onChanged={refresh}
        />
      ) : list.length === 0 ? (
        <Empty className="mt-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>
              {category === "huimin-15" && !q.trim() && !onlyFav
                ? "惠民十五五暂无模板"
                : "没有找到模板"}
            </EmptyTitle>
            <EmptyDescription>
              {category === "huimin-15" && !q.trim() && !onlyFav
                ? "分类已建立，暂未收录模板。"
                : "换个关键词试试，或者直接上传图片生成模板。"}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" asChild>
              {category === "huimin-15" ? (
                <Link to="/templates">查看全部模板</Link>
              ) : (
                <Link to="/custom">上传图片</Link>
              )}
            </Button>
          </EmptyContent>
        </Empty>
      ) : grouped ? (
        <div className="mt-6 space-y-8">
          {groups.map((g) => (
            <section key={g.id} aria-label={`分类 ${g.label}`}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="font-serif text-xl font-bold">{g.label}</h2>
                <span className="text-sm text-muted-foreground">
                  {g.items.length} 套
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {g.items.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    favorite={favs.includes(t.id)}
                    onToggleFavorite={() => toggle(t.id)}
                    onUse={() => start(t.id)}
                    busy={busy === t.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {visibleList.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              favorite={favs.includes(t.id)}
              onToggleFavorite={() => toggle(t.id)}
              onUse={() => start(t.id)}
              busy={busy === t.id}
            />
          ))}
        </div>
      )}

      {category !== "custom" && !grouped && pageCount > 1 && (
        <nav
          aria-label="模板分页"
          className="mt-6 flex flex-wrap items-center justify-center gap-2"
        >
          <Button
            variant="outline"
            disabled={currentPage <= 1}
            onClick={() => changePage(currentPage - 1)}
          >
            上一页
          </Button>
          {paginationWindow(currentPage, pageCount).map((n, i) =>
            n === "gap" ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1">
                …
              </span>
            ) : (
              <Button
                key={n}
                variant={n === currentPage ? "default" : "outline"}
                aria-label={`第 ${n} 页`}
                aria-current={n === currentPage ? "page" : undefined}
                onClick={() => changePage(n)}
              >
                {n}
              </Button>
            ),
          )}
          <Button
            variant="outline"
            disabled={currentPage >= pageCount}
            onClick={() => changePage(currentPage + 1)}
          >
            下一页
          </Button>
        </nav>
      )}

      <div className="mt-10 flex items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        <Layers3 className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>
          选择模板后会创建独立作品，可修改图层和参数；保存自己的设计后，也可另存为自定义模板。
        </p>
      </div>
    </div>
  );
}
