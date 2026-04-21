import { useMemo } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Card,
  BlockStack,
  Text,
  IndexTable,
  EmptyState,
  Badge,
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
          createdAt
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

function toneFromCommentPolicy(policy) {
  const key = String(policy || "").toUpperCase();
  if (key === "CLOSED") return "warning";
  if (key === "MODERATED") return "attention";
  if (key === "AUTO_PUBLISHED") return "success";
  return "info";
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const blogs = [];
  let after = null;

  while (true) {
    const response = await admin.graphql(BLOGS_QUERY, {
      variables: { first: 100, after },
    });
    const json = await response.json();
    const connection = json?.data?.blogs;
    const edges = connection?.edges || [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      blogs.push({
        id: node.id,
        title: node.title || "Untitled",
        handle: node.handle || "-",
        updatedAt: node.updatedAt || null,
        createdAt: node.createdAt || null,
        commentPolicy: node.commentPolicy || "-",
      });
    }

    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  return { blogs };
};

export default function BlogPage() {
  const { blogs } = useLoaderData();

  const rows = useMemo(
    () =>
      blogs.map((blog, index) => (
        <IndexTable.Row id={blog.id} key={blog.id} position={index}>
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {blog.title}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>{blog.handle}</IndexTable.Cell>
          <IndexTable.Cell>
            <Badge tone={toneFromCommentPolicy(blog.commentPolicy)}>
              {blog.commentPolicy}
            </Badge>
          </IndexTable.Cell>
          <IndexTable.Cell>{formatDate(blog.createdAt)}</IndexTable.Cell>
          <IndexTable.Cell>{formatDate(blog.updatedAt)}</IndexTable.Cell>
        </IndexTable.Row>
      )),
    [blogs],
  );

  return (
    <Page title="Blogs" subtitle="Existing Shopify blogs">
      <Card>
        <BlockStack gap="300">
          <Text as="p" variant="bodySm" tone="subdued">
            Total blogs: {blogs.length}
          </Text>

          {blogs.length === 0 ? (
            <EmptyState
              heading="No blogs found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Create a blog in Shopify Admin to see it here.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "blog", plural: "blogs" }}
              itemCount={blogs.length}
              selectable={false}
              headings={[
                { title: "Title" },
                { title: "Handle" },
                { title: "Comments" },
                { title: "Created" },
                { title: "Updated" },
              ]}
            >
              {rows}
            </IndexTable>
          )}
        </BlockStack>
      </Card>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
