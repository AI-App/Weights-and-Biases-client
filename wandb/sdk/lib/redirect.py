try:
    import fcntl
    import pty
    import tty
    import termios
except ImportError:  # windows
    pty = tty = termios = fcntl = None  # type: ignore

from collections import defaultdict
import itertools
import logging
import os
import re
import select
import signal
import struct
import sys
import threading
import time

try:
    import numpy as np  # type: ignore
except ImportError:

    class _Numpy:
        def where(self, x):
            return ([i for i in range(len(x)) if x[i]],)

        def diff(self, x):
            return [x[i + 1] - x[i] for i in range(len(x) - 1)]

        def arange(self, x):
            return list(range(x))

    np = _Numpy()

from six.moves import queue
import wandb

logger = logging.getLogger("wandb")

_redirects = {"stdout": None, "stderr": None}


ANSI_CSI_RE = re.compile("\001?\033\\[((?:\\d|;)*)([a-zA-Z])\002?")
ANSI_OSC_RE = re.compile("\001?\033\\]([^\a]*)(\a)\002?")

SEP_RE = re.compile(
    "\r|\n|"
    # Unprintable ascii characters:
    + "|".join([chr(i) for i in range(2 ** 8) if repr(chr(i)).startswith("'\\x")])
)

ANSI_FG = list(map(str, itertools.chain(range(30, 40), range(90, 98))))
ANSI_BG = list(map(str, itertools.chain(range(40, 50), range(100, 108))))

ANSI_FG_DEFAULT = "39"
ANSI_BG_DEFAULT = "49"

ANSI_RESET = "0"

ANSI_STYLES = {
    "1": "bold",
    "2": "/bold",
    "3": "italics",
    "4": "underscore",
    "5": "blink",
    "7": "reverse",
    "9": "strikethrough",
    "22": "/bold",
    "23": "/italics",
    "24": "/underscore",
    "25": "/blink",
    "27": "/reverse",
    "29": "/strikethrough",
}

ANSI_STYLES_REV = {v: k for k, v in ANSI_STYLES.items()}


CSI = "\033["


def _get_char(code):
    return "\033[" + str(code) + "m"


class Char(object):
    """
    Class encapsulating a single character, its foreground, background and style attributes
    """

    __slots__ = (
        "data",
        "fg",
        "bg",
        "bold",
        "italics",
        "underscore",
        "blink",
        "strikethrough",
        "reverse",
    )

    def __init__(
        self,
        data=" ",
        fg=ANSI_FG_DEFAULT,
        bg=ANSI_BG_DEFAULT,
        bold=False,
        italics=False,
        underscore=False,
        blink=False,
        strikethrough=False,
        reverse=False,
    ):
        self.data = data
        self.fg = fg
        self.bg = bg
        self.bold = bold
        self.italics = italics
        self.underscore = underscore
        self.blink = blink
        self.strikethrough = strikethrough
        self.reverse = reverse

    def reset(self):
        # Reset everything other than data to defaults
        default = self.__class__()
        for k in self.__slots__[1:]:
            self[k] = default[k]

    def __getitem__(self, k):
        return getattr(self, k)

    def __setitem__(self, k, v):
        setattr(self, k, v)

    def copy(self, **kwargs):
        attrs = {}
        for k in self.__slots__:
            if k in kwargs:
                attrs[k] = kwargs[k]
            else:
                attrs[k] = self[k]
        return self.__class__(**attrs)

    def __eq__(self, other):
        for k in self.__slots__:
            if self[k] != other[k]:
                return False
        return True


_defchar = Char()


class Cursor(object):
    """
    2D cursor
    """

    __slots__ = ("x", "y", "char")

    def __init__(self, x=0, y=0, char=None):
        """
        x, y - 2D coordinates
        char - Next character to be written will inherit colors and styles from this character
        """
        if char is None:
            char = Char()
        self.x = x
        self.y = y
        self.char = char


class TerminalEmulator(object):
    """
    An FSM emulating a terminal. Characters are stored in a 2D matrix (buffer) indexed by the cursor.
    """

    def __init__(self):
        self.buffer = defaultdict(lambda: defaultdict(lambda: _defchar))
        self.cursor = Cursor()
        self._num_lines = None  # Cache

        # For diffing:
        self._prev_num_lines = None
        self._prev_last_line = None

    def cursor_up(self, n=1):
        n = min(n, self.cursor.y)
        self.cursor.y -= n

    def cursor_down(self, n=1):
        self.cursor.y += n

    def cursor_left(self, n=1):
        n = min(n, self.cursor.x)
        self.cursor.x -= n

    def cursor_right(self, n=1):
        self.cursor.x += n

    def carriage_return(self):
        self.cursor.x = 0

    def cursor_postion(self, line, column):
        self.cursor.x = min(column, 1) - 1
        self.cursor.y = min(line, 1) - 1

    def cursor_column(self, column):
        self.cursor.x = min(column, 1) - 1

    def cursor_line(self, line):
        self.cursor.y = min(line, 1) - 1

    def linefeed(self):
        self.cursor_down()
        self.carriage_return()

    def _get_line_len(self, n):
        if n not in self.buffer:
            return 0
        line = self.buffer[n]
        if not line:
            return 0
        n = max(line.keys())
        for i in range(n, -1, -1):
            if line[i] != _defchar:
                return i + 1
        return 0

    @property
    def num_lines(self):
        if self._num_lines is not None:
            return self._num_lines
        ret = 0
        if self.buffer:
            n = max(self.buffer.keys())
            for i in range(n, -1, -1):
                if self._get_line_len(i):
                    ret = i + 1
                    break
        self._num_lines = ret
        return ret

    def display(self):
        return [
            [self.buffer[i][j].data for j in range(self._get_line_len(i))]
            for i in range(self.num_lines)
        ]

    def erase_screen(self, mode=0):
        if mode == 0:
            for i in range(self.cursor.y + 1, self.num_lines):
                if i in self.buffer:
                    del self.buffer[i]
            self.erase_line(mode)
        if mode == 1:
            for i in range(self.cursor.y):
                if i in self.buffer:
                    del self.buffer[i]
            self.erase_line(mode)
        elif mode == 2 or mode == 3:
            self.buffer.clear()

    def erase_line(self, mode=0):
        curr_line = self.buffer[self.cursor.y]
        if mode == 0:
            for i in range(self.cursor.x, self._get_line_len(self.cursor.y)):
                if i in curr_line:
                    del curr_line[i]
        elif mode == 1:
            for i in range(self.cursor.x + 1):
                if i in curr_line:
                    del curr_line[i]
        else:
            curr_line.clear()

    def insert_lines(self, n=1):
        for i in range(self.num_lines - 1, self.cursor.y, -1):
            self.buffer[i + n] = self.buffer[i]
        for i in range(self.cursor.y + 1, self.cursor.y + 1 + n):
            if i in self.buffer:
                del self.buffer[i]

    def _write_plain_text(self, plain_text):
        self.buffer[self.cursor.y].update(
            [
                (self.cursor.x + i, self.cursor.char.copy(data=c))
                for i, c in enumerate(plain_text)
            ]
        )
        self.cursor.x += len(plain_text)

    def _write_text(self, text):
        prev_end = 0
        for match in SEP_RE.finditer(text):
            start, end = match.span()
            self._write_plain_text(text[prev_end:start])
            prev_end = end
            c = match.group()
            if c == "\n":
                self.linefeed()
            elif c == "\r":
                self.carriage_return()
            elif c == "\b":
                self.cursor_left()
            else:
                continue
        self._write_plain_text(text[prev_end:])

    def _remove_osc(self, text):
        return re.sub(ANSI_OSC_RE, "", text)

    def write(self, data):
        self._num_lines = None  # invalidate cache
        data = self._remove_osc(data)
        prev_end = 0
        for match in ANSI_CSI_RE.finditer(data):
            start, end = match.span()
            text = data[prev_end:start]
            csi = data[start:end]
            prev_end = end
            self._write_text(text)
            self._handle_csi(csi, *match.groups())
        self._write_text(data[prev_end:])

    def _handle_csi(self, csi, params, command):
        try:
            if command == "m":
                p = params.split(";")[0]
                if not p:
                    p = "0"
                if p in ANSI_FG:
                    self.cursor.char.fg = p
                elif p in ANSI_BG:
                    self.cursor.char.bg = p
                elif p == ANSI_RESET:
                    self.cursor.char.reset()
                elif p in ANSI_STYLES:
                    style = ANSI_STYLES[p]
                    off = style.startswith("/")
                    if off:
                        style = style[1:]
                    self.cursor.char[style] = not off
            else:
                abcd = {
                    "A": "cursor_up",
                    "B": "cursor_down",
                    "C": "cursor_right",
                    "D": "cursor_left",
                }
                cursor_fn = abcd.get(command)
                if cursor_fn:
                    getattr(self, cursor_fn)(int(params) if params else 1)
                elif command == "J":
                    p = params.split(";")[0]
                    p = int(p) if p else 0
                    self.erase_screen(p)
                elif command == "K":
                    p = params.split(";")[0]
                    p = int(p) if p else 0
                    self.erase_line(p)
                elif command == "L":
                    p = int(params) if params else 1
                    self.insert_lines(p)
                elif command in "Hf":
                    p = params.split(";")
                    if len(p) == 2:
                        p = (int(p[0]), int(p[1]))
                    elif len(p) == 1:
                        p = (int(p[0]), 1)
                    else:
                        p = (1, 1)
                    self.cursor_postion(*p)
        except Exception:
            pass

    def _get_line(self, n, formatting=True):
        line = self.buffer[n]
        line_len = self._get_line_len(n)
        if not formatting:
            return "".join([line[j].data for j in range(line_len)])
        else:
            # We have to loop through each character in the line and check if foreground, background and
            # other attributes (italics, bold, underline, etc) of the ith character are different from those of the
            # (i-1)th character. If different, the appropriate ascii character fors switching the color/attribute
            # should be appended to the output string before appending the actual character. This loop and subsequent
            # checks can be expensive, especially because 99% of terminal output use default colors and formatting. Even
            # in outputs that do contain colors and styles, its unlikely that they will change on a per character basis.

            # So instead we create a character list without any ascii codes (`out`), and a list of all the foregrounds
            # in the line (`fgs`) on which we call np.diff() and np.where() to find the indices where the foreground change,
            # and insert the ascii characters in the output list (`out`) on those indices. All of this is the done ony if
            # there are more than 1 foreground color in the line in the first place (`if len(set(fgs)) > 1 else None`).
            # Same logic is repeated for background colors and other attributes.

            out = [line[i].data for i in range(line_len)]

            # for dynamic insert using original indices
            idxs = np.arange(line_len)
            insert = lambda i, c: (out.insert(idxs[i], c), idxs[i:].__iadd__(1))  # noqa

            fgs = [int(_defchar.fg)] + [int(line[i].fg) for i in range(line_len)]
            [
                insert(i, _get_char(line[int(i)].fg)) for i in np.where(np.diff(fgs))[0]
            ] if len(set(fgs)) > 1 else None
            bgs = [int(_defchar.bg)] + [int(line[i].bg) for i in range(line_len)]
            [
                insert(i, _get_char(line[int(i)].bg)) for i in np.where(np.diff(bgs))[0]
            ] if len(set(bgs)) > 1 else None
            attrs = {
                k: [False] + [line[i][k] for i in range(line_len)]
                for k in Char.__slots__[3:]
            }
            [
                [
                    insert(
                        i, _get_char(ANSI_STYLES_REV[k if line[int(i)][k] else "/" + k])
                    )
                    for i in np.where(np.diff(v))[0]
                ]
                for k, v in attrs.items()
                if any(v)
            ]
            return "".join(out)

    def read(self):
        num_lines = self.num_lines
        if self._prev_num_lines is None:
            ret = os.linesep.join(map(self._get_line, range(num_lines)))
            if ret:
                ret += os.linesep
            else:
                return ret
        else:
            curr_line = self._get_line(self._prev_num_lines - 1)
            if curr_line == self._prev_last_line:
                if num_lines == self._prev_num_lines:
                    return ""
                ret = (
                    os.linesep.join(
                        map(self._get_line, range(self._prev_num_lines, num_lines))
                    )
                    + os.linesep
                )
            else:
                ret = (
                    "\r"
                    + os.linesep.join(
                        map(self._get_line, range(self._prev_num_lines - 1, num_lines))
                    )
                    + os.linesep
                )
        self._prev_num_lines = num_lines
        self._prev_last_line = self._get_line(num_lines - 1)
        return ret


_MIN_CALLBACK_INTERVAL = 2  # seconds


class RedirectBase(object):
    def __init__(self, src, cbs=()):
        """
        # Arguments

        `src`: Source stream to be redirected. "stdout" or "stderr".
        `cbs`: tuple/list of callbacks. Each callback should take exactly 1 argument (bytes).

        """
        assert hasattr(sys, src)
        self.src = src
        self.cbs = cbs

    @property
    def src_stream(self):
        return getattr(sys, "__%s__" % self.src)

    @property
    def src_fd(self):
        return self.src_stream.fileno()

    @property
    def src_wrapped_stream(self):
        return getattr(sys, self.src)

    def install(self):
        curr_redirect = _redirects.get(self.src)
        if curr_redirect and curr_redirect != self:
            curr_redirect.uninstall()
        _redirects[self.src] = self

    def uninstall(self):
        if _redirects[self.src] != self:
            return
        _redirects[self.src] = None


class _WrappedStream(object):
    """
    For python 2.7 only.
    """

    def __init__(self, stream, write_f):
        object.__setattr__(self, "write", write_f)
        object.__setattr__(self, "_stream", stream)

    def __getattr__(self, attr):
        return getattr(self._stream, attr)


class StreamWrapper(RedirectBase):
    """
    Patches the write method of current sys.stdout/sys.stderr
    """

    def __init__(self, src, cbs=()):
        super(StreamWrapper, self).__init__(src=src, cbs=cbs)
        self._installed = False
        self._emulator = TerminalEmulator()

    def _emulator_write(self):
        while not self._stopped.is_set():
            if self._queue.empty():
                time.sleep(0.5)
                continue
            while not self._queue.empty():
                data = self._queue.get()
                if isinstance(data, bytes):
                    try:
                        data = data.decode("utf-8")
                    except UnicodeDecodeError:
                        # TODO(frz)
                        data = ""
                try:
                    self._emulator.write(data)
                except Exception:
                    pass

    def _callback(self):
        while not self._stopped.is_set():
            self.flush()
            time.sleep(_MIN_CALLBACK_INTERVAL)

    def install(self):
        super(StreamWrapper, self).install()
        if self._installed:
            return
        stream = self.src_wrapped_stream
        old_write = stream.write
        self._prev_callback_timestamp = time.time()
        self._old_write = old_write

        def write(data):
            self._old_write(data)
            self._queue.put(data)

        if sys.version_info[0] > 2:
            stream.write = write
        else:
            self._old_stream = stream
            setattr(sys, self.src, _WrappedStream(stream, write))

        self._queue = queue.Queue()
        self._stopped = threading.Event()
        self._emulator_write_thread = threading.Thread(target=self._emulator_write)
        self._emulator_write_thread.daemon = True
        self._emulator_write_thread.start()

        if not wandb.run or wandb.run._settings.mode == "online":
            self._callback_thread = threading.Thread(target=self._callback)
            self._callback_thread.daemon = True
            self._callback_thread.start()

        self._installed = True

    def flush(self):
        try:
            data = self._emulator.read().encode("utf-8")
        except Exception:
            data = b""
        if data:
            for cb in self.cbs:
                try:
                    cb(data)
                except Exception:
                    pass  # TODO(frz)

    def uninstall(self):
        if not self._installed:
            return
        if sys.version_info[0] > 2:
            self.src_wrapped_stream.write = self._old_write
        else:
            setattr(sys, self.src, self._old_stream)

        # Joining daemonic thread might hang, so we wait for the queue to empty out instead:
        cnt = 0
        while not self._queue.empty():
            time.sleep(0.1)
            cnt += 1
            if cnt == 100:  # bail after 10 seconds
                logger.warning(
                    "StreamWrapper: queue not empty after 10 seconds. Dropping logs."
                )
                break

        self._stopped.set()
        self.flush()
        self._installed = False

        super(StreamWrapper, self).uninstall()


class _WindowSizeChangeHandler(object):
    def __init__(self):
        self._fds = set()

    def _register(self):
        old_handler = signal.signal(signal.SIGWINCH, lambda *_: None)

        def handler(signum, frame):
            if callable(old_handler):
                old_handler(signum, frame)
            self.handle_window_size_change()

        signal.signal(signal.SIGWINCH, handler)
        self._old_handler = old_handler

    def _unregister(self):
        signal.signal(signal.SIGWINCH, self._old_handler)

    def add_fd(self, fd):
        if not self._fds:
            self._register()
        self._fds.add(fd)
        self.handle_window_size_change()

    def remove_fd(self, fd):
        if fd in self._fds:
            self._fds.remove(fd)
            if not self._fds:
                self._unregister()

    def handle_window_size_change(self):
        try:
            win_size = fcntl.ioctl(0, termios.TIOCGWINSZ, "\0" * 8)
            rows, cols, xpix, ypix = struct.unpack("HHHH", win_size)
        # Note: IOError not subclass of OSError in python 2.x
        except (OSError, IOError):  # eg. in MPI we can't do this. # noqa
            return
        if cols == 0:
            return
        win_size = struct.pack("HHHH", rows, cols, xpix, ypix)
        for fd in self._fds:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, win_size)


_WSCH = _WindowSizeChangeHandler()


class Redirect(RedirectBase):
    """
    Redirects low level file descriptors.
    """

    def __init__(self, src, cbs=()):
        super(Redirect, self).__init__(src=src, cbs=cbs)
        self._installed = False
        self._emulator = TerminalEmulator()

    def _pipe(self):
        if pty:
            r, w = pty.openpty()
        else:
            r, w = os.pipe()
        return r, w

    def install(self):
        super(Redirect, self).install()
        if self._installed:
            return
        self._pipe_read_fd, self._pipe_write_fd = self._pipe()
        if os.isatty(self._pipe_read_fd):
            _WSCH.add_fd(self._pipe_read_fd)
        self._orig_src_fd = os.dup(self.src_fd)
        self._orig_src = os.fdopen(self._orig_src_fd, "wb", 0)
        os.dup2(self._pipe_write_fd, self.src_fd)
        self._installed = True
        self._stopped = threading.Event()
        self._pipe_relay_thread = threading.Thread(target=self._pipe_relay)
        self._pipe_relay_thread_stopped = threading.Event()
        self._pipe_relay_thread.daemon = True
        self._pipe_relay_thread.start()
        self._queue = queue.Queue()
        self._stopped = threading.Event()
        self._emulator_write_thread = threading.Thread(target=self._emulator_write)
        self._emulator_write_thread.daemon = True
        self._emulator_write_thread.start()
        if not wandb.run or wandb.run._settings.mode == "online":
            self._callback_thread = threading.Thread(target=self._callback)
            self._callback_thread.daemon = True
            self._callback_thread.start()

    def uninstall(self):
        if not self._installed:
            return
        self._installed = False

        self._stopped.set()
        os.dup2(self._orig_src_fd, self.src_fd)

        if not self._pipe_relay_thread_stopped.wait(timeout=60):
                logger.warning(
                    "Redirect: _pipe_relay_thread did not join in 60 seconds. Some terminal output might be lost."
                )
        os.close(self._pipe_write_fd)
        os.close(self._pipe_read_fd)

        t = threading.Thread(
            target=self.src_wrapped_stream.flush
        )  # Calling flush() from the current thread does not flush the buffer instantly.
        t.start()
        t.join(timeout=10)

        # Joining daemonic thread might hang, so we wait for the queue to empty out instead:
        cnt = 0
        while not self._queue.empty():
            time.sleep(0.1)
            cnt += 1
            if cnt == 100:  # bail after 10 seconds
                logger.warning(
                    "Redirect: queue not empty after 10 seconds. Dropping logs."
                )
                break

        self.flush()
        _WSCH.remove_fd(self._pipe_read_fd)
        super(Redirect, self).uninstall()

    def flush(self):
        try:
            data = self._emulator.read().encode("utf-8")
        except Exception:
            data = b""
        if data:
            for cb in self.cbs:
                try:
                    cb(data)
                except Exception:
                    pass  # TODO(frz)

    def _callback(self):
        while not self._stopped.is_set():
            self.flush()
            time.sleep(_MIN_CALLBACK_INTERVAL)

    def _pipe_relay(self):
        has_data = (
            lambda: self._pipe_read_fd in select.select([self._pipe_read_fd], [], [], 0)[0]
        )
        while True:
            try:
                if has_data():
                    data = os.read(self._pipe_read_fd, 4096)
                elif self._stopped.is_set():
                    self._pipe_relay_thread_stopped.set()
                    return
                else:
                    time.sleep(0.1)
                    continue
                i = self._orig_src.write(data)
                if i is not None:  # python 3 w/ unbuffered i/o: we need to keep writing
                    while i < len(data):
                        i += self._orig_src.write(data[i:])
            except OSError:
                self._pipe_relay_thread_stopped.set()
                return
            self._queue.put(data)

    def _emulator_write(self):
        while not self._stopped.is_set():
            if self._queue.empty():
                time.sleep(0.5)
                continue
            while not self._queue.empty():
                data = self._queue.get()
                try:
                    self._emulator.write(data.decode("utf-8"))
                except Exception:
                    pass
