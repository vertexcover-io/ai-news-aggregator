import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";

describe("cn()", () => {
  it("merges conflicting utility classes so the last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("filters out falsy values", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});

describe("UI primitives render without throwing", () => {
  it("Button", () => {
    const { getByRole } = render(<Button>Click</Button>);
    expect(getByRole("button")).toBeTruthy();
  });

  it("Input", () => {
    const { container } = render(<Input placeholder="hi" />);
    expect(container.querySelector("input")).toBeTruthy();
  });

  it("Label", () => {
    const { getByText } = render(<Label htmlFor="x">My Label</Label>);
    expect(getByText("My Label")).toBeTruthy();
  });

  it("Switch", () => {
    const { getByRole } = render(<Switch aria-label="toggle" />);
    expect(getByRole("switch")).toBeTruthy();
  });

  it("Badge", () => {
    const { getByText } = render(<Badge>new</Badge>);
    expect(getByText("new")).toBeTruthy();
  });

  it("Card + subcomponents", () => {
    const { getByText } = render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(getByText("Title")).toBeTruthy();
    expect(getByText("Body")).toBeTruthy();
  });

  it("Separator", () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toBeTruthy();
  });

  it("Tabs", () => {
    const { getByText } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
      </Tabs>,
    );
    expect(getByText("Panel A")).toBeTruthy();
  });

  it("Table", () => {
    const { getByText } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Col</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(getByText("Cell")).toBeTruthy();
  });

  it("Dialog (closed)", () => {
    const { getByText } = render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(getByText("Open")).toBeTruthy();
  });

  it("Select (closed)", () => {
    const { container } = render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(container.querySelector("[data-slot='select-trigger']")).toBeTruthy();
  });

  it("Toaster", () => {
    const { container } = render(<Toaster />);
    expect(container).toBeTruthy();
  });
});
