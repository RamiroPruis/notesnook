import { groupBy, isHex } from "../utils";
import Collection from "./collection";
import {
  getWeekGroupFromTimestamp,
  months,
  getLastWeekTimestamp,
  get7DayTimestamp,
} from "../utils/date";
import Note from "../models/note";
import getId from "../utils/id";
import { EV } from "../common";
import { getContentFromData } from "../content-types";
import qclone from "qclone/src/qclone";
var tfun = require("transfun/transfun.js").tfun;
if (!tfun) {
  tfun = global.tfun;
}

export default class Notes extends Collection {
  async add(noteArg) {
    if (!noteArg) return;

    let id = noteArg.id || getId();
    let oldNote = this._collection.getItem(id);

    if (noteArg.remote || noteArg.migrated) {
      if (oldNote) {
        if (oldNote.color !== noteArg.color) {
          await this._db.colors.remove(oldNote.color, id);
        }
        if (oldNote.tags) {
          for (let tag of oldNote.tags) {
            await this._db.tags.remove(tag, id);
          }
        }
      }

      if (noteArg.color) {
        await this._db.colors.add(noteArg.color, id);
      }

      if (noteArg.tags && noteArg.tags.length) {
        for (let tag of noteArg.tags) {
          await this._db.tags.add(tag, id);
        }
      }

      return await this._collection.addItem(noteArg);
    }

    let note = {
      ...oldNote,
      ...noteArg,
    };

    if (!oldNote && !noteArg.content && !noteArg.contentId) return;

    if (noteArg.content && noteArg.content.data && noteArg.content.type) {
      const { type, data, conflicted, resolved } = noteArg.content;

      let content = getContentFromData(type, data);
      if (!content) throw new Error("Invalid content type.");
      note.title = getNoteTitle(note, content);
      note.headline = getNoteHeadline(note, content);

      if (isNoteEmpty(note, content)) {
        if (oldNote) {
          EV.publish("notes:removeEmptyNote", id);
          await this.remove(id);
        }
        return;
      }

      note.contentId = await this._db.content.add({
        noteId: id,
        id: note.contentId,
        type,
        data,
        conflicted,
        resolved,
      });
    }

    note = {
      id,
      contentId: note.contentId,
      type: "note",
      title: note.title,
      headline: note.headline,
      pinned: !!note.pinned,
      locked: !!note.locked,
      notebooks: note.notebooks || undefined,
      color: note.color,
      tags: note.tags || [],
      favorite: !!note.favorite,
      dateCreated: note.dateCreated,
      conflicted: !!note.conflicted,
    };

    if (!oldNote || oldNote.deleted) {
      if (note.color) await this._db.colors.add(note.color, id);

      for (let tag of note.tags) {
        await this._db.tags.add(tag, id);
      }
    }

    await this._collection.addItem(note);
    return note.id;
  }

  /**
   *
   * @param {string} id The id of note
   * @returns {Note} The note of the given id
   */
  note(id) {
    if (!id) return;
    let note = id.type ? id : this._collection.getItem(id);
    if (!note || note.deleted) return;
    return new Note(note, this._db);
  }

  get raw() {
    return this._collection.getRaw();
  }

  get all() {
    return this._collection.getItems();
  }

  get pinned() {
    return tfun.filter(".pinned === true")(this.all);
  }

  get conflicted() {
    return tfun.filter(".conflicted === true")(this.all);
  }

  get favorites() {
    return tfun.filter(".favorite === true")(this.all);
  }

  tagged(tagId) {
    const tag = this._db.tags.tag(tagId);
    if (!tag || tag.noteIds.length <= 0) return [];
    return tag.noteIds.map((id) => this._collection.getItem(id));
  }

  colored(colorId) {
    const color = this._db.colors.tag(colorId);
    if (!color || color.noteIds.length <= 0) return [];
    return color.noteIds.map((id) => this._collection.getItem(id));
  }

  /**
   *
   * @param {"abc"|"month"|"year"|"week"|undefined} by
   * @param {"asc"|"desc"} sort
   */
  group(by, sort = "desc") {
    let notes = this.all;

    switch (by) {
      case "abc":
        return groupBy(
          notes,
          (note) => note.title[0].toUpperCase(),
          (t) => t.title[0],
          sort
        );
      case "month":
        return groupBy(
          notes,
          (note) => months[new Date(note.dateCreated).getMonth()],
          (t) => t.dateCreated,
          sort
        );
      case "week":
        return groupBy(
          notes,
          (note) => getWeekGroupFromTimestamp(note.dateCreated),
          (t) => t.dateCreated,
          sort
        );
      case "year":
        return groupBy(
          notes,
          (note) => new Date(note.dateCreated).getFullYear().toString(),
          (t) => t.dateCreated,
          sort
        );
      default:
        let timestamps = {
          recent: getLastWeekTimestamp(7),
          lastWeek: getLastWeekTimestamp(7) - get7DayTimestamp(), //seven day timestamp value
        };
        return groupBy(
          notes,
          (note) =>
            note.dateCreated >= timestamps.recent
              ? "Recent"
              : note.dateCreated >= timestamps.lastWeek
              ? "Last week"
              : "Older",
          (t) => t.dateCreated,
          sort
        );
    }
  }

  delete(...ids) {
    return this._delete(true, ...ids);
  }

  remove(...ids) {
    return this._delete(false, ...ids);
  }

  /**
   * @private
   */
  async _delete(moveToTrash = true, ...ids) {
    for (let id of ids) {
      let item = this.note(id);
      if (!item) continue;
      const itemData = qclone(item.data);
      if (item.notebooks) {
        for (let notebook of item.notebooks) {
          for (let topic of notebook.topics) {
            await this._db.notebooks
              .notebook(notebook.id)
              .topics.topic(topic)
              .delete(id);
          }
        }
      }
      for (let tag of item.tags) {
        await this._db.tags.remove(tag, id);
      }
      if (item.data.color) {
        await this._db.colors.remove(item.data.color, id);
      }
      await this._collection.removeItem(id);
      if (moveToTrash) await this._db.trash.add(itemData);
    }
  }

  async move(to, ...noteIds) {
    if (!to) throw new Error("The destination notebook cannot be undefined.");
    if (!to.id || !to.topic)
      throw new Error(
        "The destination notebook must contain notebookId and topic."
      );
    let topic = this._db.notebooks.notebook(to.id).topics.topic(to.topic);
    if (!topic) throw new Error("No such topic exists.");
    await topic.add(...noteIds);
  }
}

function isNoteEmpty(note, content) {
  const { title, locked } = note;
  const isTitleEmpty = !title || !title.trim().length;
  return !locked && isTitleEmpty && content.isEmpty();
}

function getNoteHeadline(note, content) {
  if (note.locked) return "";
  return content.toHeadline();
}

function getNoteTitle(note, content) {
  if (note.title && note.title.trim().length > 0)
    return note.title.replace(/\r?\n/g, " ");
  return content.toTitle();
}
