import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

const BLOGS_QUERY = `#graphql
  query BlogList($first: Int!, $after: String) {
    blogs(first: $first, after: $after, sortKey: TITLE) {
      edges {
        node {
          id
          title
          handle
          updatedAt
          commentPolicy
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query ArticleList($first: Int!, $after: String) {
    articles(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          title
          body
          handle
          updatedAt
          publishedAt
          blog {
            id
            title
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ARTICLE_CREATE_MUTATION = `#graphql
  mutation ArticleCreate($blogId: ID!, $article: ArticleCreateInput!) {
    articleCreate(blogId: $blogId, article: $article) {
      article {
        id
        title
        body
        handle
        updatedAt
        publishedAt
        blog {
          id
          title
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ARTICLE_UPDATE_MUTATION = `#graphql
  mutation ArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article {
        id
        title
        body
        handle
        updatedAt
        publishedAt
        blog {
          id
          title
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "-";
  }
}

function makeGeneratedBlog(topicInput) {
  const topic = cleanText(topicInput) || "Shopify Growth Tips";
  const title = topic.length > 68 ? topic.slice(0, 68).trim() : `${topic}: Practical Guide`;
  const content = [
    `<h2>Why ${topic} matters</h2>`,
    `<p>${topic} can improve discoverability, engagement, and conversion when your message is clear and structured.</p>`,
    "<h2>How to implement</h2>",
    `<p>Start with one focused customer pain point, add proof points, and close with a clear next step.</p>`,
    "<h2>Checklist</h2>",
    "<ul><li>Define audience intent</li><li>Use benefit-led headings</li><li>Add actionable CTA</li></ul>",
  ].join("");

  return { title, content };
}

function normalizeArticle(node) {
  return {
    id: node.id,
    title: cleanText(node.title) || "Untitled",
    body: node.body || "",
    handle: cleanText(node.handle) || "-",
    updatedAt: node.updatedAt || null,
    publishedAt: node.publishedAt || null,
    blogId: node.blog?.id || "",
    blogTitle: node.blog?.title || "-",
  };
}

function getSummaryFromBody(body) {
  const plain = stripHtml(body || "");
  if (!plain) return "-";
  if (plain.length <= 120) return plain;
  return `${plain.slice(0, 120).trim()}...`;
}

function statusBadge(publishedAt) {
  return publishedAt ? <Badge tone="success">Published</Badge> : <Badge tone="attention">Draft</Badge>;
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const blogs = [];
  let after = null;
  while (true) {
    const response = await admin.graphql(BLOGS_QUERY, { variables: { first: 100, after } });
    const json = await response.json();
    const connection = json?.data?.blogs;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      blogs.push({
        id: node.id,
        title: cleanText(node.title) || "Untitled",
        handle: cleanText(node.handle) || "-",
        updatedAt: node.updatedAt || null,
        commentPolicy: node.commentPolicy || "-",
      });
    }

    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  const articles = [];
  after = null;
  while (true) {
    const response = await admin.graphql(ARTICLES_QUERY, { variables: { first: 100, after } });
    const json = await response.json();
    const connection = json?.data?.articles;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      articles.push(normalizeArticle(node));
    }

    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  return { blogs, articles };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "create_blog") {
    const blogId = cleanText(formData.get("blogId"));
    const topic = cleanText(formData.get("topic"));
    if (!blogId) return { ok: false, intent, error: "Please select a blog." };
    if (!topic) return { ok: false, intent, error: "Please enter a topic." };

    const generated = makeGeneratedBlog(topic);
    const response = await admin.graphql(ARTICLE_CREATE_MUTATION, {
      variables: {
        blogId,
        article: {
          title: generated.title,
          body: generated.content,
        },
      },
    });
    const json = await response.json();
    const payload = json?.data?.articleCreate;
    const errors = payload?.userErrors || [];
    if (errors.length) {
      return { ok: false, intent, error: errors.map((e) => e.message).join(", ") };
    }

    return { ok: true, intent, article: normalizeArticle(payload.article) };
  }

  if (intent === "regenerate_blog") {
    const articleId = cleanText(formData.get("articleId"));
    const seed = cleanText(formData.get("seed"));
    if (!articleId) return { ok: false, intent, error: "Missing article id." };

    const generated = makeGeneratedBlog(seed || "Updated Shopify article");
    const response = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
      variables: {
        id: articleId,
        article: {
          title: generated.title,
          body: generated.content,
        },
      },
    });
    const json = await response.json();
    const payload = json?.data?.articleUpdate;
    const errors = payload?.userErrors || [];
    if (errors.length) {
      return { ok: false, intent, error: errors.map((e) => e.message).join(", ") };
    }

    return { ok: true, intent, article: normalizeArticle(payload.article) };
  }

  if (intent === "save_blog_content") {
    const articleId = cleanText(formData.get("articleId"));
    const title = cleanText(formData.get("title"));
    const body = String(formData.get("body") || "").trim();
    if (!articleId) return { ok: false, intent, error: "Missing article id." };
    if (!title) return { ok: false, intent, error: "Title is required." };

    const response = await admin.graphql(ARTICLE_UPDATE_MUTATION, {
      variables: {
        id: articleId,
        article: {
          title,
          body,
        },
      },
    });
    const json = await response.json();
    const payload = json?.data?.articleUpdate;
    const errors = payload?.userErrors || [];
    if (errors.length) {
      return { ok: false, intent, error: errors.map((e) => e.message).join(", ") };
    }

    return { ok: true, intent, article: normalizeArticle(payload.article) };
  }

  return { ok: false, intent, error: "Unknown action." };
};

export default function BlogPage() {
  const { blogs, articles } = useLoaderData();
  const fetcher = useFetcher();
  const [rows, setRows] = useState(() => articles);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createBlogId, setCreateBlogId] = useState(() => blogs?.[0]?.id || "");
  const [createTopic, setCreateTopic] = useState("");
  const [createStatus, setCreateStatus] = useState("draft");
  const [editingArticle, setEditingArticle] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const editorRef = useRef(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!editingArticle || !editorRef.current) return;
    editorRef.current.innerHTML = editingArticle.body || "";
  }, [editingArticle]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (!fetcher.data.ok) {
      setMessage(fetcher.data.error || "Operation failed.");
      return;
    }

    const nextArticle = fetcher.data.article;
    if (!nextArticle) return;

    setRows((prev) => {
      const exists = prev.some((item) => item.id === nextArticle.id);
      if (!exists) return [nextArticle, ...prev];
      return prev.map((item) => (item.id === nextArticle.id ? nextArticle : item));
    });

    if (fetcher.data.intent === "create_blog") {
      setIsCreateOpen(false);
      setCreateTopic("");
      setMessage("Blog created successfully.");
    }

    if (fetcher.data.intent === "regenerate_blog") {
      setMessage("Blog regenerated successfully.");
    }

    if (fetcher.data.intent === "save_blog_content") {
      setEditingArticle(null);
      setMessage("Blog content updated.");
    }
  }, [fetcher.state, fetcher.data]);

  const blogOptions = useMemo(() => {
    if (!blogs.length) return [{ label: "No blogs found", value: "" }];
    return blogs.map((blog) => ({ label: blog.title, value: blog.id }));
  }, [blogs]);

  const rowsMarkup = useMemo(
    () =>
      rows.map((article, index) => (
        <IndexTable.Row id={article.id} key={article.id} position={index}>
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {article.title}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>{article.blogTitle}</IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" variant="bodySm" tone="subdued">
              {getSummaryFromBody(article.body)}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Button
              size="slim"
              onClick={() => {
                setEditingArticle(article);
                setEditTitle(article.title);
              }}
            >
              Open editor
            </Button>
          </IndexTable.Cell>
          <IndexTable.Cell>{statusBadge(article.publishedAt)}</IndexTable.Cell>
          <IndexTable.Cell>{formatDate(article.updatedAt)}</IndexTable.Cell>
          <IndexTable.Cell>
            <Button
              size="slim"
              onClick={() => {
                const payload = new FormData();
                payload.append("intent", "regenerate_blog");
                payload.append("articleId", article.id);
                payload.append("seed", article.title);
                fetcher.submit(payload, { method: "post" });
              }}
              disabled={fetcher.state !== "idle"}
            >
              Regenerate
            </Button>
          </IndexTable.Cell>
        </IndexTable.Row>
      )),
    [rows, fetcher],
  );

  return (
    <Page title="Blogs" subtitle="Generate blog title and content, edit, and regenerate from one table.">
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">
              Total articles: {rows.length}
            </Text>
            <Button variant="primary" onClick={() => setIsCreateOpen(true)} disabled={!blogs.length}>
              Create Blog
            </Button>
          </InlineStack>

          {message ? (
            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
              <Text as="p" variant="bodySm">{message}</Text>
            </Box>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              heading="No blog articles found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Click Create Blog to generate your first article.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "article", plural: "articles" }}
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "Title" },
                { title: "Summary" },
                { title: "Content" },
                { title: "Status" },
                { title: "Updated" },
                { title: "Regenerate" },
              ]}
            >
              {rowsMarkup}
            </IndexTable>
          )}
        </BlockStack>
      </Card>

      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Blog">
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Topic"
              value={createTopic}
              onChange={setCreateTopic}
              autoComplete="off"
              placeholder="e.g. 10 ways to improve product page SEO"
            />
            <Select
              label="Status"
              options={[
                { label: "Draft", value: "draft" },
                { label: "Published", value: "published" },
              ]}
              value={createStatus}
              onChange={setCreateStatus}
            />
            <InlineStack align="end" gap="200">
              <Button onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={fetcher.state !== "idle" && String(fetcher.formData?.get("intent")) === "create_blog"}
                onClick={() => {
                  const payload = new FormData();
                  payload.append("intent", "create_blog");
                  payload.append("blogId", createBlogId);
                  payload.append("topic", createTopic);
                  payload.append("status", createStatus);
                  fetcher.submit(payload, { method: "post" });
                }}
              >
                Generate Blog
              </Button>
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(editingArticle)}
        onClose={() => setEditingArticle(null)}
        title="Blog Text Editor"
        large
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Title"
              value={editTitle}
              onChange={setEditTitle}
              autoComplete="off"
            />
            <div style={{ border: "1px solid #d1d5db", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
              <InlineStack gap="100" wrap>
                <Button size="slim" onClick={() => document.execCommand("bold")}>B</Button>
                <Button size="slim" onClick={() => document.execCommand("italic")}>I</Button>
                <Button size="slim" onClick={() => document.execCommand("underline")}>U</Button>
                <Button size="slim" onClick={() => document.execCommand("insertUnorderedList")}>• List</Button>
                <Button size="slim" onClick={() => document.execCommand("insertOrderedList")}>1. List</Button>
                <Button size="slim" onClick={() => document.execCommand("removeFormat")}>Clear</Button>
              </InlineStack>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                style={{
                  minHeight: 340,
                  padding: 16,
                  outline: "none",
                  fontSize: 18,
                  lineHeight: 1.6,
                }}
              />
            </div>
            <InlineStack align="end" gap="200">
              <Button onClick={() => setEditingArticle(null)}>Close</Button>
              <Button
                variant="primary"
                loading={fetcher.state !== "idle" && String(fetcher.formData?.get("intent")) === "save_blog_content"}
                onClick={() => {
                  if (!editingArticle) return;
                  const payload = new FormData();
                  payload.append("intent", "save_blog_content");
                  payload.append("articleId", editingArticle.id);
                  payload.append("title", editTitle);
                  payload.append("body", editorRef.current?.innerHTML || "");
                  fetcher.submit(payload, { method: "post" });
                }}
              >
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
